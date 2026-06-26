/*
 * This file is part of rpgm-ai-translator.
 *
 * Copyright (C) 2026 Nikita Fedorov
 *
 * rpgm-ai-translator is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * rpgm-ai-translator is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with rpgm-ai-translator. If not, see <https://www.gnu.org/licenses/>.
 */

import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { loadGlossary } from "../../config/public-api.js";
import { loadCharacterGlossary } from "../../config/public-api.js";
import {
  applyFontPatch,
  assertPatchOutputOutsideGame,
  writePatch
} from "../../engines/rpgmaker-mvmz/public-api.js";
import { detectEngine } from "../../engines/registry.js";
import { printOwnershipNotice } from "../legal.js";
import { estimateTotalTokens, TokenBudget } from "../../core/cost.js";
import { acquireDirectoryLock, LOCK_FILENAME, withDirectoryLock } from "../../core/locks.js";
import { isNonEmptyDirectory, writeFileAtomic } from "../../core/utils/fs.js";
import { JsonlTranslationMemory } from "../../core/memory/public-api.js";
import { persistResultsToMemory, translateWithMemory, translationCacheKey } from "../../core/memory/public-api.js";
import { repairTranslations } from "../../core/pipeline/public-api.js";
import { createReport, dominantFailureCause, summarizeReport, writeReportFile } from "../../core/reports/public-api.js";
import { reviewTranslations } from "../../core/pipeline/public-api.js";
import {
  appendTranslationResultsJsonlFile,
  readTranslationResultsFile,
  readTranslationResultsJsonlFile,
  resetTranslationResultsJsonlFile,
  writeTranslationResultsFile,
  writeTranslationUnitsFile
} from "../../core/translation-units.js";
import {
  DefaultValidator,
  filterTranslationsWithoutValidationErrors,
  validateTranslationResults
} from "../../core/validators/public-api.js";
import { createProvider } from "../../providers/public-api.js";
import {
  assertProviderReady,
  echoTargetLanguage,
  hasFlag,
  readExtractOptions,
  readFontOptions,
  readIssueCodesOption,
  readNumberOption,
  readOption,
  readProviderConfig,
  readProviderName,
  readPositiveIntegerOption,
  readTranslateCliOptions,
  requirePositional,
  requireOption,
  UsageError
} from "../options/public-api.js";
import {
  checkpointedTranslationsById,
  checkpointSignature,
  checkpointSignaturesEqual,
  computeExtractionFlagsHash,
  computeGameId,
  mergeCheckpointTranslations,
  missingCheckpointResult,
  readCheckpointSignatureFile,
  writeCheckpointSignatureFile
} from "../checkpoints.js";
import { createProgressLogger } from "../progress.js";
import type { TranslateOptions, TranslationResult, TranslationUnit } from "../../core/types/public-api.js";
import type { CliIO } from "../types.js";

export async function runCommand(args: string[], io: CliIO): Promise<number> {
  printOwnershipNotice(io.stderr);
  const projectPath = requirePositional(args, 0, "project path");
  const outDir = requireOption(args, "--out");
  assertPatchOutputOutsideGame(projectPath, outDir);
  // A dry run writes nothing, so it does not need (and should not take) the lock.
  if (hasFlag(args, "--dry-run")) {
    return executeRun(args, io);
  }
  // Hold an exclusive lock on the work dir for the whole run so a second run
  // sharing it cannot interleave checkpoint/memory appends and corrupt them.
  const workDir = readOption(args, "--work-dir") ?? `${outDir}-work`;
  const lock = await acquireDirectoryLock(workDir);
  // SIGINT/SIGTERM (common on a long run) bypass the finally below, so remove the
  // lock synchronously here and re-raise the signal so the process still exits
  // with the conventional code instead of leaving a lock owned by a dead pid.
  const onSignal = (signal: NodeJS.Signals): void => {
    lock.releaseSync();
    process.kill(process.pid, signal);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    return await executeRun(args, io);
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    await lock.release();
  }
}

async function executeRun(args: string[], io: CliIO): Promise<number> {
  const projectPath = requirePositional(args, 0, "project path");
  const outDir = requireOption(args, "--out");
  assertPatchOutputOutsideGame(projectPath, outDir);
  if (readOption(args, "--mode") != null || readOption(args, "--backup") != null) {
    io.stderr("Warning: run always writes a patch; --mode and --backup are ignored.\n");
  }
  const dryRun = hasFlag(args, "--dry-run");
  const providerName = readProviderName(args);
  if (!dryRun) {
    assertProviderReady(providerName);
  }
  // Echo the resolved target and warn when it fell back to the default, so a
  // forgotten --target is caught here rather than after a full paid patch ships
  // in the wrong language.
  echoTargetLanguage(args, io.stderr, { warnOnDefault: true });
  const providerOptions = readTranslateCliOptions(args);
  const extractOptions = readExtractOptions(args);
  const { fontPath, numberFontPath } = readFontOptions(args);
  const glossaryPath = readOption(args, "--glossary");
  const charactersPath = readOption(args, "--characters");
  const repairEnabled = hasFlag(args, "--repair");
  // Accept repair's --attempts/--codes as aliases so a user does not have to learn
  // two names for the same setting; the run-specific names take precedence.
  const repairAttempts =
    readPositiveIntegerOption(args, "--repair-attempts") ?? readPositiveIntegerOption(args, "--attempts") ?? 1;
  const repairCodes = readIssueCodesOption(args, "--repair-codes") ?? readIssueCodesOption(args, "--codes");
  const tokenBudgetLimit = readPositiveIntegerOption(args, "--max-tokens-budget");
  const budget = tokenBudgetLimit != null ? new TokenBudget(tokenBudgetLimit) : undefined;
  // Intermediate artifacts (units, raw/reviewed/repaired translations, memory,
  // report) go to the work directory, not the patch directory, so the patch
  // folder holds only game files and proprietary memory is not shipped with it.
  const workDir = readOption(args, "--work-dir") ?? `${outDir}-work`;
  const memoryPath = readOption(args, "--memory") ?? path.join(workDir, "translation-memory.jsonl");
  const { detected, adapter } = await detectEngine(projectPath);
  if (detected.engine === "unknown") {
    throw new Error(`Unsupported or unknown RPG Maker engine for '${projectPath}'`);
  }

  const extractionWarnings: string[] = [];
  const units = await adapter.createExtractor().extract(projectPath, {
    ...extractOptions,
    onWarning: (warning) => {
      extractionWarnings.push(warning);
      io.stderr(`Warning: ${warning}\n`);
    }
  });
  const glossary = glossaryPath ? await loadGlossary(glossaryPath) : undefined;
  const characterGlossary = charactersPath ? await loadCharacterGlossary(charactersPath) : undefined;

  // Persist a JSONL checkpoint per batch and resume from it, so a crash mid-run
  // does not discard completed translate/review/repair work on the next run.
  const rawCheckpointPath = path.join(workDir, "translations.raw.jsonl");
  const reviewCheckpointPath = path.join(workDir, "translations.reviewed.jsonl");
  const repairCheckpointPath = path.join(workDir, "translations.repaired.jsonl");
  // How many repair attempts a prior (possibly crashed) run already completed for
  // this signature. Persisted so a resume continues the budget instead of
  // restarting at attempt 1, which could spend well past --repair-attempts.
  const repairProgressPath = path.join(workDir, "repair-progress.json");
  // Discard checkpoints from a run with different parameters (target language,
  // model, provider or glossary); resuming them would ship stale output such as
  // the previous language. A missing signature (an older work dir) is treated as
  // compatible to preserve resume, then stamped for next time.
  const checkpointMeta = path.join(workDir, "checkpoint.meta.json");
  // Identify the source game so two different games translated into the same --out
  // (and therefore the same default work dir) cannot resume each other's
  // checkpoints or reuse each other's memory.
  const gameId = computeGameId(projectPath, detected.engine);
  // Fold the extraction flags into the signature: they change which units exist
  // and their constraints, but the per-result source check cannot see a flag flip
  // (an unchanged dialogue line keeps its id/source even when its maxLength budget
  // changed via --dialogue-max-length), so a flag change must discard the resume.
  const extractionFlagsHash = computeExtractionFlagsHash(extractOptions);
  const signature = checkpointSignature(providerName, providerOptions, glossary, characterGlossary, {
    gameId,
    extractionFlagsHash
  });
  const previousSignature = await readCheckpointSignatureFile(checkpointMeta);
  // A non-empty stored gameId that differs means this work dir last served another
  // game; clear its memory too, not just the checkpoints (a pre-gameId meta reads
  // as "" and is treated as the same game to preserve an upgraded work dir).
  const gameChanged =
    previousSignature.status === "ok" &&
    previousSignature.signature.gameId !== "" &&
    previousSignature.signature.gameId !== signature.gameId;
  const usingDefaultMemory = readOption(args, "--memory") == null;
  // Resume only when the signature is absent (older work dir) or matches; a present
  // but unparseable/incomplete signature is treated as stale and the checkpoints
  // are discarded below.
  const resume =
    previousSignature.status === "absent" ||
    (previousSignature.status === "ok" && checkpointSignaturesEqual(previousSignature.signature, signature));
  const rawCheckpointById: Map<string, TranslationResult> = resume
    ? checkpointedTranslationsById(units, await readTranslationResultsJsonlFile(rawCheckpointPath))
    : new Map();
  let unitsToTranslate = units.filter((unit) => !rawCheckpointById.has(unit.id));

  if (dryRun) {
    return previewDryRun(args, io, {
      detectedEngine: detected.engine,
      outDir,
      units,
      unitsToTranslate,
      resumedCount: rawCheckpointById.size,
      memoryPath,
      memoryOptions: { ...providerOptions, glossary, characterGlossary },
      batchSize: providerOptions.batchSize,
      review: hasFlag(args, "--review"),
      repair: repairEnabled
    });
  }

  // Estimate over the units actually being sent (after checkpoint resume), not the
  // full extraction, and before any files are written, so a resumed run is not
  // falsely blocked and an over-budget run leaves nothing behind.
  budget?.assertEstimateWithin(estimateTotalTokens(unitsToTranslate, { batchSize: providerOptions.batchSize }));

  // A different game (or an unrelated pre-existing directory) sharing this --out
  // would have its leftover files mixed into the sparse patch. Allow overwriting
  // only an --out this same game produced (matching gameId); otherwise refuse
  // unless --force. The run lock file does not count toward "non-empty".
  const ownsOutDir = previousSignature.status === "ok" && previousSignature.signature.gameId === signature.gameId;
  if (!hasFlag(args, "--force") && !ownsOutDir && (await isNonEmptyDirectory(outDir, [LOCK_FILENAME]))) {
    throw new UsageError(
      `Output directory '${outDir}' already contains files not produced by this game. Patch mode writes only changed files, so they would be mixed with this run. Use a new --out, or pass --force to overwrite it.`
    );
  }
  await mkdir(workDir, { recursive: true });
  await mkdir(outDir, { recursive: true });
  await writeTranslationUnitsFile(path.join(workDir, "units.json"), units);
  io.stderr(
    `Detected ${detected.engine}. Extracted ${units.length} units from ${new Set(units.map((unit) => unit.filePath)).size} files. Work directory: ${workDir}\n`
  );
  if (!resume) {
    io.stderr(
      gameChanged
        ? "Warning: this output directory was last used for a different game; discarding its checkpoints and translation memory and starting fresh.\n"
        : "Warning: run parameters (language, model, sampling, glossary or extraction flags) changed since the last run; discarding stale checkpoints and starting fresh.\n"
    );
    await Promise.all([
      resetTranslationResultsJsonlFile(rawCheckpointPath),
      resetTranslationResultsJsonlFile(reviewCheckpointPath),
      resetTranslationResultsJsonlFile(repairCheckpointPath),
      rm(repairProgressPath, { force: true })
    ]);
    // A different game must not reuse the prior game's translation memory either.
    // Only the work-dir default memory is cleared; an explicit --memory the user
    // chose to share is left alone (its cache key already scopes by language/model).
    if (gameChanged && usingDefaultMemory) {
      await rm(memoryPath, { force: true });
    }
  }
  await writeCheckpointSignatureFile(checkpointMeta, signature);
  // Fold hand-edited translations back into the run. A translator can correct
  // translations.json (or any results file) and pass --from-translations to seed
  // those edits into the checkpoint, instead of resume silently overwriting them.
  // Done after the stale-checkpoint reset so a fresh run still honors the import.
  const fromTranslationsPath = readOption(args, "--from-translations");
  if (fromTranslationsPath) {
    const importedById = checkpointedTranslationsById(units, await readTranslationResultsFile(fromTranslationsPath));
    if (importedById.size > 0) {
      importedById.forEach((result, id) => rawCheckpointById.set(id, result));
      await appendTranslationResultsJsonlFile(rawCheckpointPath, Array.from(importedById.values()));
      unitsToTranslate = units.filter((unit) => !rawCheckpointById.has(unit.id));
      io.stderr(`Imported ${importedById.size} hand-edited translation(s) from ${fromTranslationsPath} into the checkpoint.\n`);
    } else {
      io.stderr(
        `Warning: --from-translations '${fromTranslationsPath}' had no entries matching this game's units (by id and source); ignoring it.\n`
      );
    }
  } else if (resume) {
    // Discoverability: a translator who edited the work-dir translations.json may
    // not know resume reads the JSONL checkpoint, not that file. If it is newer
    // than the checkpoint, point them at --from-translations rather than dropping
    // their edits silently.
    const editable = path.join(workDir, "translations.json");
    const [editedAt, checkpointAt] = await Promise.all([fileMtimeMs(editable), fileMtimeMs(rawCheckpointPath)]);
    if (editedAt != null && checkpointAt != null && editedAt > checkpointAt) {
      io.stderr(
        `Warning: '${editable}' was edited after the last checkpoint, but resume reads the checkpoint, not that file. ` +
          `Re-run with --from-translations '${editable}' to fold those edits in.\n`
      );
    }
  }
  const provider = createProvider(providerName, readProviderConfig(args));
  const memory = new JsonlTranslationMemory(memoryPath);
  // The cache-key inputs shared by the translate lookup and the reviewed/repaired
  // persistence below; the callbacks are not part of the key, so they are kept off
  // this base object (they are spread into the translate call only).
  const memoryOptions = { ...providerOptions, glossary, characterGlossary };
  if (rawCheckpointById.size > 0) {
    io.stderr(`Resuming translation: ${rawCheckpointById.size}/${units.length} units already in checkpoint.\n`);
  }
  const translatedResults = await translateWithMemory(
    unitsToTranslate,
    provider,
    {
      ...memoryOptions,
      onProgress: createProgressLogger(io),
      onBatchResults: async (batchResults) => {
        await appendTranslationResultsJsonlFile(rawCheckpointPath, batchResults);
        budget?.record(batchResults);
        budget?.assertWithin();
      }
    },
    memory
  );
  const translatedById = new Map(translatedResults.map((result) => [result.id, result]));
  let translations = units.map(
    (unit) =>
      translatedById.get(unit.id) ??
      rawCheckpointById.get(unit.id) ??
      missingCheckpointResult(unit, providerName, providerOptions.model)
  );
  // Stop before applying when nothing translated (e.g. a total provider outage),
  // so the run fails loudly instead of writing an empty patch and exiting 0.
  const translatedCount = translations.filter((result) => result.status === "translated").length;
  if (units.length > 0 && translatedCount === 0) {
    io.stderr(
      `All ${units.length} translation units failed; no translations were produced.${dominantFailureCause(translations)} Aborting before writing a patch.\n`
    );
    return 1;
  }
  await writeTranslationResultsFile(path.join(workDir, "translations.raw.json"), translations);
  if (hasFlag(args, "--review")) {
    const reviewCheckpointById = checkpointedTranslationsById(units, await readTranslationResultsJsonlFile(reviewCheckpointPath));
    if (reviewCheckpointById.size > 0) {
      io.stderr(`Resuming review: ${reviewCheckpointById.size}/${units.length} units already in checkpoint.\n`);
    }
    const unitsToReview = units.filter((unit) => !reviewCheckpointById.has(unit.id));
    // Estimate the review pass against the budget already spent on translate, so a
    // run that would overrun fails here instead of mid-review with tokens wasted.
    budget?.assertProjectedWithin(estimateTotalTokens(unitsToReview, { batchSize: providerOptions.batchSize }));
    const reviewResult = await reviewTranslations(
      unitsToReview,
      mergeCheckpointTranslations(units, translations, reviewCheckpointById),
      provider,
      {
        ...providerOptions,
        glossary,
        characterGlossary,
        onProgress: createProgressLogger(io),
        onBatchResults: async (batchResults) => {
          await appendTranslationResultsJsonlFile(reviewCheckpointPath, batchResults);
          budget?.record(batchResults);
          budget?.assertWithin();
        }
      }
    );
    translations = reviewResult.translations;
    await writeTranslationResultsFile(path.join(workDir, "translations.reviewed.json"), translations);
    io.stderr(`Reviewed: ${reviewResult.reviewed}, failed: ${reviewResult.failed}, skipped: ${reviewResult.skipped}\n`);
    // Persist the reviewed text to memory under the translate cache key so a later
    // run reuses the reviewed quality instead of replaying the raw translation
    // (and does not re-spend review tokens on it).
    await persistResultsToMemory(units, translations, memoryOptions, memory, { reviewed: true });
  }
  io.stderr("Validating translations...\n");
  let validationIssues = validateTranslationResults(units, translations, new DefaultValidator(glossary));
  if (repairEnabled) {
    const repairCheckpointById = checkpointedTranslationsById(units, await readTranslationResultsJsonlFile(repairCheckpointPath));
    if (repairCheckpointById.size > 0) {
      translations = mergeCheckpointTranslations(units, translations, repairCheckpointById);
      validationIssues = validateTranslationResults(units, translations, new DefaultValidator(glossary));
      io.stderr(`Resuming repair: ${repairCheckpointById.size} units already in checkpoint.\n`);
    }
    // Continue the attempt budget from where a prior crashed run left off, so a
    // resume cannot run --repair-attempts more passes on top of what was already
    // spent. A fresh signature reset the counter above; a clean finish clears it
    // below, so only an interrupted loop leaves it set.
    const attemptsCompleted = resume ? await readRepairAttemptsCompleted(repairProgressPath) : 0;
    if (attemptsCompleted > 0) {
      io.stderr(`Resuming repair: ${attemptsCompleted} attempt(s) already completed in a prior run.\n`);
    }
    for (let attempt = attemptsCompleted + 1; attempt <= repairAttempts && validationIssues.length > 0; attempt += 1) {
      // Estimate this repair attempt (the units carrying the targeted issues)
      // against tokens already spent, failing before the pass if it would overrun.
      const repairUnitIds = new Set(validationIssues.map((issue) => issue.id));
      budget?.assertProjectedWithin(
        estimateTotalTokens(units.filter((unit) => repairUnitIds.has(unit.id)), { batchSize: providerOptions.batchSize })
      );
      io.stderr(`Repairing validation issues, attempt ${attempt}/${repairAttempts} (${validationIssues.length} issues)...\n`);
      const repairResult = await repairTranslations(units, translations, validationIssues, provider, {
        ...providerOptions,
        glossary,
        characterGlossary,
        issueCodes: repairCodes,
        onProgress: createProgressLogger(io),
        onBatchResults: async (batchResults) => {
          await appendTranslationResultsJsonlFile(repairCheckpointPath, batchResults);
          budget?.record(batchResults);
          budget?.assertWithin();
        }
      });
      translations = repairResult.translations;
      io.stderr(
        `Repair attempt ${attempt}/${repairAttempts}: repaired ${repairResult.repaired}, translated ${repairResult.translated}, reviewed ${repairResult.reviewed}, failed ${repairResult.failed}, skipped ${repairResult.skipped}\n`
      );
      // Record the completed attempt before the convergence check so a crash on the
      // next pass resumes from here.
      await writeRepairAttemptsCompleted(repairProgressPath, attempt);
      io.stderr("Revalidating translations...\n");
      validationIssues = validateTranslationResults(units, translations, new DefaultValidator(glossary));
      if (repairResult.repaired === 0) {
        break;
      }
    }
    // The repair budget for this run is fully accounted for; clear the counter so a
    // later deliberate re-run of the same game gets the full --repair-attempts again.
    await rm(repairProgressPath, { force: true });
    // Persist the repaired text to memory so a re-run reuses it instead of the raw
    // (or merely reviewed) translation that still tripped a validation rule.
    await persistResultsToMemory(units, translations, memoryOptions, memory, { repaired: true });
  }
  const safeTranslations = filterTranslationsWithoutValidationErrors(translations, validationIssues);
  io.stderr(`Applying patch with ${safeTranslations.length}/${translations.length} validation-safe translations...\n`);
  // Patch from the units already extracted with the full run flags (comments,
  // dialogue length) rather than re-extracting with a narrower set, which dropped
  // comment translations as id mismatches. Lock the out dir for the write so a
  // concurrent run/apply with a different --work-dir cannot interleave into it.
  await withDirectoryLock(path.resolve(outDir), async () => {
    await writePatch(projectPath, units, safeTranslations, {
      mode: "patch",
      outDir,
      onWarning: (warning) => io.stderr(`Warning: ${warning}\n`)
    });
    if (fontPath) {
      io.stderr("Applying font patch...\n");
      await applyFontPatch(projectPath, outDir, {
        fontPath,
        numberFontPath,
        onWarning: (warning) => io.stderr(`Warning: ${warning}\n`)
      });
    }
  });
  io.stderr("Writing translations...\n");
  await writeTranslationResultsFile(path.join(workDir, "translations.json"), translations);
  const report = createReport({ units, translations, validationIssues, engine: detected.engine, warnings: extractionWarnings });
  io.stderr("Writing report...\n");
  await writeReportFile(path.join(workDir, "report.json"), report);
  io.stderr(`${summarizeReport(report)}\n`);
  // Mirror `validate`: exit 2 when the patch ships without a translation we actually
  // produced that still fails validation (a dropped placeholder, altered number, ...),
  // so a CI chain or agent sees the broken output instead of a clean success. A unit
  // the provider merely failed to deliver (status "failed"/"skipped") is a
  // non-delivery — already in the report's failed count and the empty-output guard
  // above — and should not, by itself, fail an otherwise good run over a provider
  // hiccup.
  const safeIds = new Set(safeTranslations.map((translation) => translation.id));
  const blockingProduced = translations.filter(
    (translation) => !safeIds.has(translation.id) && translation.status === "translated"
  );
  if (blockingProduced.length > 0) {
    io.stderr(
      `Patch written without ${blockingProduced.length} produced translation(s) that still carry blocking validation errors; validate and repair before shipping.\n`
    );
    return 2;
  }
  return 0;
}

// Reads the count of repair attempts a prior run for this work dir already
// completed. A missing, unreadable, or malformed file reads as zero, so a corrupt
// progress file at worst grants the full attempt budget rather than failing the run.
async function readRepairAttemptsCompleted(progressPath: string): Promise<number> {
  try {
    const parsed = JSON.parse(await readFile(progressPath, "utf8")) as { attemptsCompleted?: unknown };
    const value = parsed.attemptsCompleted;
    return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

async function writeRepairAttemptsCompleted(progressPath: string, attemptsCompleted: number): Promise<void> {
  await writeFileAtomic(progressPath, `${JSON.stringify({ attemptsCompleted })}\n`);
}

// Modification time in ms, or undefined when the file is missing. Used to notice a
// translations.json a translator edited after the last checkpoint.
async function fileMtimeMs(filePath: string): Promise<number | undefined> {
  try {
    return (await stat(filePath)).mtimeMs;
  } catch {
    return undefined;
  }
}

// Report what a run would do without writing anything: the estimate is scoped to
// the units actually sent (excluding checkpoint resumes and translation-memory
// hits) and includes the review/repair passes that are enabled, plus an optional
// USD band from --price-per-1k. Reads the memory only to count hits.
async function previewDryRun(
  args: string[],
  io: CliIO,
  params: {
    detectedEngine: string;
    outDir: string;
    units: TranslationUnit[];
    unitsToTranslate: TranslationUnit[];
    resumedCount: number;
    memoryPath: string;
    memoryOptions: TranslateOptions;
    batchSize: number | undefined;
    review: boolean;
    repair: boolean;
  }
): Promise<number> {
  const memory = new JsonlTranslationMemory(params.memoryPath);
  const pending: TranslationUnit[] = [];
  let memoryHits = 0;
  for (const unit of params.unitsToTranslate) {
    const cached = await memory.get(translationCacheKey(unit, params.memoryOptions));
    if (cached && cached.status === "translated") {
      memoryHits += 1;
    } else {
      pending.push(unit);
    }
  }

  const translateTokens = estimateTotalTokens(pending, { batchSize: params.batchSize });
  const reviewTokens = params.review ? estimateTotalTokens(params.units, { batchSize: params.batchSize }) : 0;
  // Repair is a targeted subset; estimate one pass over the pending units as a
  // rough upper bound for the preview.
  const repairTokens = params.repair ? estimateTotalTokens(pending, { batchSize: params.batchSize }) : 0;
  const totalTokens = translateTokens + reviewTokens + repairTokens;

  const passes = ["translate", ...(params.review ? ["review"] : []), ...(params.repair ? ["repair"] : [])].join(" + ");
  const price = readNumberOption(args, "--price-per-1k", { min: 0 });
  // The estimate is approximate, so quote a band (half to double) rather than a
  // single misleadingly-precise figure.
  const usdNote =
    price != null
      ? ` ~$${(((totalTokens / 1000) * price) / 2).toFixed(3)}–$${((totalTokens / 1000) * price * 2).toFixed(3)} (at $${price}/1k tokens)`
      : "";

  io.stderr(
    `[dry run] Detected ${params.detectedEngine}. ${params.units.length} units: ${params.resumedCount} already in checkpoint, ` +
      `${memoryHits} memory hit(s), ${pending.length} to translate. Passes: ${passes}. ` +
      `Estimated ~${totalTokens} total tokens${usdNote}. Patch would go to '${params.outDir}'. No files were written.\n`
  );
  return 0;
}
