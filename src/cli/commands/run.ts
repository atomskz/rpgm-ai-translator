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

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { loadCharacterGlossary, loadGlossary } from "../../config/index.js";
import { MvMzEngineDetector } from "../../core/engine-detector/index.js";
import { RpgMakerMvMzExtractor } from "../../core/extractors/index.js";
import { applyFontPatch } from "../../core/font-patch/index.js";
import { estimateInputTokens, TokenBudget } from "../../core/cost/index.js";
import { acquireDirectoryLock } from "../../core/locks/index.js";
import { JsonlTranslationMemory, translateWithMemory } from "../../core/memory/index.js";
import { assertPatchOutputOutsideGame } from "../../core/patch-writer/index.js";
import { repairTranslations } from "../../core/repair/index.js";
import { createReport, summarizeReport, writeReportFile } from "../../core/reports/index.js";
import { reviewTranslations } from "../../core/review/index.js";
import {
  appendTranslationResultsJsonlFile,
  readTranslationResultsJsonlFile,
  resetTranslationResultsJsonlFile,
  writeTranslationResultsFile,
  writeTranslationUnitsFile
} from "../../core/translation-units/index.js";
import {
  DefaultValidator,
  filterTranslationsWithoutValidationErrors,
  validateTranslationResults
} from "../../core/validators/index.js";
import { createProvider } from "../../providers/index.js";
import {
  assertProviderReady,
  hasFlag,
  readExtractOptions,
  readFontOptions,
  readIssueCodesOption,
  readOption,
  readProviderConfig,
  readProviderName,
  readPositiveIntegerOption,
  readTranslateCliOptions,
  requirePositional,
  requireOption
} from "../options.js";
import {
  checkpointedTranslationsById,
  checkpointSignature,
  checkpointSignaturesEqual,
  mergeCheckpointTranslations,
  missingCheckpointResult,
  readCheckpointSignatureFile,
  writeCheckpointSignatureFile
} from "../checkpoints.js";
import { createProgressLogger } from "../progress.js";
import type { TranslationResult } from "../../core/types.js";
import type { CliIO } from "../types.js";

export async function runCommand(args: string[], io: CliIO): Promise<number> {
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
  const detector = new MvMzEngineDetector();
  const detected = await detector.detect(projectPath);
  if (detected.engine === "unknown") {
    throw new Error(`Unsupported or unknown RPG Maker engine for '${projectPath}'`);
  }

  const extractionWarnings: string[] = [];
  const units = await new RpgMakerMvMzExtractor(detector).extract(projectPath, {
    ...extractOptions,
    onWarning: (warning) => {
      extractionWarnings.push(warning);
      io.stderr(`Warning: ${warning}\n`);
    }
  });
  if (dryRun) {
    io.stderr(
      `[dry run] Detected ${detected.engine}. Would extract ${units.length} units from ${new Set(units.map((unit) => unit.filePath)).size} files (estimated ~${estimateInputTokens(units)} input tokens) and translate, validate and patch into '${outDir}'. No files were written.\n`
    );
    return 0;
  }
  const glossary = glossaryPath ? await loadGlossary(glossaryPath) : undefined;
  const characterGlossary = charactersPath ? await loadCharacterGlossary(charactersPath) : undefined;

  // Persist a JSONL checkpoint per batch and resume from it, so a crash mid-run
  // does not discard completed translate/review/repair work on the next run.
  const rawCheckpointPath = path.join(workDir, "translations.raw.jsonl");
  const reviewCheckpointPath = path.join(workDir, "translations.reviewed.jsonl");
  const repairCheckpointPath = path.join(workDir, "translations.repaired.jsonl");
  // Discard checkpoints from a run with different parameters (target language,
  // model, provider or glossary); resuming them would ship stale output such as
  // the previous language. A missing signature (an older work dir) is treated as
  // compatible to preserve resume, then stamped for next time.
  const checkpointMeta = path.join(workDir, "checkpoint.meta.json");
  const signature = checkpointSignature(providerName, providerOptions, glossary, characterGlossary);
  const previousSignature = await readCheckpointSignatureFile(checkpointMeta);
  const resume = !previousSignature || checkpointSignaturesEqual(previousSignature, signature);
  const rawCheckpointById: Map<string, TranslationResult> = resume
    ? checkpointedTranslationsById(units, await readTranslationResultsJsonlFile(rawCheckpointPath))
    : new Map();
  const unitsToTranslate = units.filter((unit) => !rawCheckpointById.has(unit.id));
  // Estimate over the units actually being sent (after checkpoint resume), not the
  // full extraction, and before any files are written, so a resumed run is not
  // falsely blocked and an over-budget run leaves nothing behind.
  budget?.assertEstimateWithin(estimateInputTokens(unitsToTranslate));

  await mkdir(workDir, { recursive: true });
  await mkdir(outDir, { recursive: true });
  await writeTranslationUnitsFile(path.join(workDir, "units.json"), units);
  io.stderr(
    `Detected ${detected.engine}. Extracted ${units.length} units from ${new Set(units.map((unit) => unit.filePath)).size} files. Work directory: ${workDir}\n`
  );
  if (!resume) {
    io.stderr(
      "Warning: run parameters (language/model/glossary) changed since the last run; discarding stale checkpoints and starting fresh.\n"
    );
    await Promise.all([
      resetTranslationResultsJsonlFile(rawCheckpointPath),
      resetTranslationResultsJsonlFile(reviewCheckpointPath),
      resetTranslationResultsJsonlFile(repairCheckpointPath)
    ]);
  }
  await writeCheckpointSignatureFile(checkpointMeta, signature);
  const provider = createProvider(providerName, readProviderConfig(args));
  if (rawCheckpointById.size > 0) {
    io.stderr(`Resuming translation: ${rawCheckpointById.size}/${units.length} units already in checkpoint.\n`);
  }
  const translatedResults = await translateWithMemory(
    unitsToTranslate,
    provider,
    {
      ...providerOptions,
      glossary,
      onProgress: createProgressLogger(io),
      onBatchResults: async (batchResults) => {
        await appendTranslationResultsJsonlFile(rawCheckpointPath, batchResults);
        budget?.record(batchResults);
        budget?.assertWithin();
      }
    },
    new JsonlTranslationMemory(memoryPath)
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
    io.stderr(`All ${units.length} translation units failed; no translations were produced. Aborting before writing a patch.\n`);
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
    budget?.assertProjectedWithin(estimateInputTokens(unitsToReview));
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
    for (let attempt = 1; attempt <= repairAttempts && validationIssues.length > 0; attempt += 1) {
      // Estimate this repair attempt (the units carrying the targeted issues)
      // against tokens already spent, failing before the pass if it would overrun.
      const repairUnitIds = new Set(validationIssues.map((issue) => issue.id));
      budget?.assertProjectedWithin(estimateInputTokens(units.filter((unit) => repairUnitIds.has(unit.id))));
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
      io.stderr("Revalidating translations...\n");
      validationIssues = validateTranslationResults(units, translations, new DefaultValidator(glossary));
      if (repairResult.repaired === 0) {
        break;
      }
    }
  }
  const safeTranslations = filterTranslationsWithoutValidationErrors(translations, validationIssues);
  io.stderr(`Applying patch with ${safeTranslations.length}/${translations.length} validation-safe translations...\n`);
  await new RpgMakerMvMzExtractor(detector).applyTranslations(projectPath, safeTranslations, {
    mode: "patch",
    outDir,
    includePlugins: extractOptions.includePlugins,
    includeSpeakerNames: extractOptions.includeSpeakerNames,
    onWarning: (warning) => io.stderr(`Warning: ${warning}\n`)
  });
  if (fontPath) {
    io.stderr("Applying font patch...\n");
    await applyFontPatch(projectPath, outDir, { fontPath, numberFontPath });
  }
  io.stderr("Writing translations...\n");
  await writeTranslationResultsFile(path.join(workDir, "translations.json"), translations);
  const report = createReport({ units, translations, validationIssues, engine: detected.engine, warnings: extractionWarnings });
  io.stderr("Writing report...\n");
  await writeReportFile(path.join(workDir, "report.json"), report);
  io.stderr(`${summarizeReport(report)}\n`);
  return 0;
}
