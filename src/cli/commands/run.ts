import { mkdir } from "node:fs/promises";
import path from "node:path";
import { loadCharacterGlossary, loadGlossary } from "../../config/index.js";
import { MvMzEngineDetector } from "../../core/engine-detector/index.js";
import { RpgMakerMvMzExtractor } from "../../core/extractors/index.js";
import { applyFontPatch } from "../../core/font-patch/index.js";
import { JsonlTranslationMemory, translateWithMemory } from "../../core/memory/index.js";
import { assertPatchOutputOutsideGame } from "../../core/patch-writer/index.js";
import { repairTranslations } from "../../core/repair/index.js";
import { createReport, summarizeReport, writeReportFile } from "../../core/reports/index.js";
import { reviewTranslations } from "../../core/review/index.js";
import {
  appendTranslationResultsJsonlFile,
  readTranslationResultsJsonlFile,
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
  readApplyOptions,
  readExtractOptions,
  readFontOptions,
  readIssueCodesOption,
  readOption,
  readProviderConfig,
  readProviderName,
  readPositiveIntegerOption,
  readTranslateCliOptions,
  requireArg,
  requireOption
} from "../options.js";
import {
  checkpointedTranslationsById,
  mergeCheckpointTranslations,
  missingCheckpointResult
} from "../checkpoints.js";
import { createProgressLogger } from "../progress.js";
import type { CliIO } from "../types.js";

export async function runCommand(args: string[], io: CliIO): Promise<number> {
  const projectPath = requireArg(args[0], "project path");
  const outDir = requireOption(args, "--out");
  assertPatchOutputOutsideGame(projectPath, outDir);
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
  const repairAttempts = readPositiveIntegerOption(args, "--repair-attempts") ?? 1;
  const repairCodes = readIssueCodesOption(args, "--repair-codes");
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
    io.stdout(
      `[dry run] Detected ${detected.engine}. Would extract ${units.length} units from ${new Set(units.map((unit) => unit.filePath)).size} files and translate, validate and patch into '${outDir}'. No files were written.\n`
    );
    return 0;
  }
  await mkdir(workDir, { recursive: true });
  await mkdir(outDir, { recursive: true });
  await writeTranslationUnitsFile(path.join(workDir, "units.json"), units);
  io.stdout(
    `Detected ${detected.engine}. Extracted ${units.length} units from ${new Set(units.map((unit) => unit.filePath)).size} files. Work directory: ${workDir}\n`
  );
  const glossary = glossaryPath ? await loadGlossary(glossaryPath) : undefined;
  const characterGlossary = charactersPath ? await loadCharacterGlossary(charactersPath) : undefined;
  const provider = createProvider(providerName, readProviderConfig(args));

  // Persist a JSONL checkpoint per batch and resume from it, so a crash mid-run
  // does not discard completed translate/review/repair work on the next run.
  const rawCheckpointPath = path.join(workDir, "translations.raw.jsonl");
  const rawCheckpointById = checkpointedTranslationsById(units, await readTranslationResultsJsonlFile(rawCheckpointPath));
  if (rawCheckpointById.size > 0) {
    io.stdout(`Resuming translation: ${rawCheckpointById.size}/${units.length} units already in checkpoint.\n`);
  }
  const unitsToTranslate = units.filter((unit) => !rawCheckpointById.has(unit.id));
  const translatedResults = await translateWithMemory(
    unitsToTranslate,
    provider,
    {
      ...providerOptions,
      glossary,
      onProgress: createProgressLogger(io),
      onBatchResults: async (batchResults) => {
        await appendTranslationResultsJsonlFile(rawCheckpointPath, batchResults);
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
  await writeTranslationResultsFile(path.join(workDir, "translations.raw.json"), translations);
  if (hasFlag(args, "--review")) {
    const reviewCheckpointPath = path.join(workDir, "translations.reviewed.jsonl");
    const reviewCheckpointById = checkpointedTranslationsById(units, await readTranslationResultsJsonlFile(reviewCheckpointPath));
    if (reviewCheckpointById.size > 0) {
      io.stdout(`Resuming review: ${reviewCheckpointById.size}/${units.length} units already in checkpoint.\n`);
    }
    const unitsToReview = units.filter((unit) => !reviewCheckpointById.has(unit.id));
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
        }
      }
    );
    translations = reviewResult.translations;
    await writeTranslationResultsFile(path.join(workDir, "translations.reviewed.json"), translations);
    io.stdout(`Reviewed: ${reviewResult.reviewed}, failed: ${reviewResult.failed}, skipped: ${reviewResult.skipped}\n`);
  }
  io.stdout("Validating translations...\n");
  let validationIssues = validateTranslationResults(units, translations, new DefaultValidator(glossary));
  if (repairEnabled) {
    const repairCheckpointPath = path.join(workDir, "translations.repaired.jsonl");
    const repairCheckpointById = checkpointedTranslationsById(units, await readTranslationResultsJsonlFile(repairCheckpointPath));
    if (repairCheckpointById.size > 0) {
      translations = mergeCheckpointTranslations(units, translations, repairCheckpointById);
      validationIssues = validateTranslationResults(units, translations, new DefaultValidator(glossary));
      io.stdout(`Resuming repair: ${repairCheckpointById.size} units already in checkpoint.\n`);
    }
    for (let attempt = 1; attempt <= repairAttempts && validationIssues.length > 0; attempt += 1) {
      io.stdout(`Repairing validation issues, attempt ${attempt}/${repairAttempts} (${validationIssues.length} issues)...\n`);
      const repairResult = await repairTranslations(units, translations, validationIssues, provider, {
        ...providerOptions,
        glossary,
        characterGlossary,
        issueCodes: repairCodes,
        onProgress: createProgressLogger(io),
        onBatchResults: async (batchResults) => {
          await appendTranslationResultsJsonlFile(repairCheckpointPath, batchResults);
        }
      });
      translations = repairResult.translations;
      io.stdout(
        `Repair attempt ${attempt}/${repairAttempts}: repaired ${repairResult.repaired}, translated ${repairResult.translated}, reviewed ${repairResult.reviewed}, failed ${repairResult.failed}, skipped ${repairResult.skipped}\n`
      );
      io.stdout("Revalidating translations...\n");
      validationIssues = validateTranslationResults(units, translations, new DefaultValidator(glossary));
      if (repairResult.repaired === 0) {
        break;
      }
    }
  }
  const safeTranslations = filterTranslationsWithoutValidationErrors(translations, validationIssues);
  io.stdout(`Applying patch with ${safeTranslations.length}/${translations.length} validation-safe translations...\n`);
  await new RpgMakerMvMzExtractor(detector).applyTranslations(projectPath, safeTranslations, {
    ...readApplyOptions(args),
    mode: "patch",
    outDir,
    includePlugins: extractOptions.includePlugins,
    includeSpeakerNames: extractOptions.includeSpeakerNames
  });
  if (fontPath) {
    io.stdout("Applying font patch...\n");
    await applyFontPatch(projectPath, outDir, { fontPath, numberFontPath });
  }
  io.stdout("Writing translations...\n");
  await writeTranslationResultsFile(path.join(workDir, "translations.json"), translations);
  const report = createReport({ units, translations, validationIssues, engine: detected.engine, warnings: extractionWarnings });
  io.stdout("Writing report...\n");
  await writeReportFile(path.join(workDir, "report.json"), report);
  io.stdout(`${summarizeReport(report)}\n`);
  return 0;
}
