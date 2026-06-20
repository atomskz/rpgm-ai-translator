import { mkdir } from "node:fs/promises";
import path from "node:path";
import { loadCharacterGlossary, loadGlossary } from "../../config/index.js";
import { MvMzEngineDetector } from "../../core/engine-detector/index.js";
import { RpgMakerMvMzExtractor } from "../../core/extractors/index.js";
import { applyFontPatch } from "../../core/font-patch/index.js";
import { JsonlTranslationMemory, translateWithMemory } from "../../core/memory/index.js";
import { repairTranslations } from "../../core/repair/index.js";
import { createReport, summarizeReport, writeReportFile } from "../../core/reports/index.js";
import { reviewTranslations } from "../../core/review/index.js";
import {
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
  readIssueCodesOption,
  readNonNegativeIntegerOption,
  readOption,
  readPositiveIntegerOption,
  requireArg,
  requireOption
} from "../options.js";
import { createProgressLogger } from "../progress.js";
import type { CliIO } from "../types.js";

export async function runCommand(args: string[], io: CliIO): Promise<number> {
  const projectPath = requireArg(args[0], "project path");
  const outDir = requireOption(args, "--out");
  const providerName = readOption(args, "--provider") ?? "mock";
  assertProviderReady(providerName);
  const targetLanguage = readOption(args, "--target") ?? "ru";
  const model = readOption(args, "--model");
  const batchSize = readPositiveIntegerOption(args, "--batch-size");
  const retryAttempts = readNonNegativeIntegerOption(args, "--retry-attempts");
  const timeoutMs = readPositiveIntegerOption(args, "--timeout-ms");
  const glossaryPath = readOption(args, "--glossary");
  const charactersPath = readOption(args, "--characters");
  const fontPath = readOption(args, "--font");
  const numberFontPath = readOption(args, "--number-font");
  const repairEnabled = hasFlag(args, "--repair");
  const repairAttempts = readPositiveIntegerOption(args, "--repair-attempts") ?? 1;
  const repairCodes = readIssueCodesOption(args, "--repair-codes");
  const memoryPath = readOption(args, "--memory") ?? path.join(outDir, "translation-memory.jsonl");
  const detector = new MvMzEngineDetector();
  const detected = await detector.detect(projectPath);
  if (detected.engine === "unknown") {
    throw new Error(`Unsupported or unknown RPG Maker engine for '${projectPath}'`);
  }

  const units = await new RpgMakerMvMzExtractor(detector).extract(projectPath, {
    includeEventComments: hasFlag(args, "--include-comments"),
    includePlugins: hasFlag(args, "--include-plugins"),
    includeSpeakerNames: hasFlag(args, "--include-speaker-names")
  });
  await mkdir(outDir, { recursive: true });
  await writeTranslationUnitsFile(path.join(outDir, "units.json"), units);
  io.stdout(
    `Detected ${detected.engine}. Extracted ${units.length} units from ${new Set(units.map((unit) => unit.filePath)).size} files.\n`
  );
  const glossary = glossaryPath ? await loadGlossary(glossaryPath) : undefined;
  const characterGlossary = charactersPath ? await loadCharacterGlossary(charactersPath) : undefined;
  const provider = createProvider(providerName);
  let translations = await translateWithMemory(
    units,
    provider,
    {
      targetLanguage,
      model,
      glossary,
      batchSize,
      retryAttempts,
      timeoutMs,
      onProgress: createProgressLogger(io)
    },
    new JsonlTranslationMemory(memoryPath)
  );
  if (hasFlag(args, "--review")) {
    const reviewResult = await reviewTranslations(units, translations, provider, {
      targetLanguage,
      model,
      glossary,
      characterGlossary,
      batchSize,
      timeoutMs,
      onProgress: createProgressLogger(io)
    });
    translations = reviewResult.translations;
    io.stdout(`Reviewed: ${reviewResult.reviewed}, failed: ${reviewResult.failed}, skipped: ${reviewResult.skipped}\n`);
  }
  io.stdout("Validating translations...\n");
  let validationIssues = validateTranslationResults(units, translations, new DefaultValidator(glossary));
  if (repairEnabled) {
    for (let attempt = 1; attempt <= repairAttempts && validationIssues.length > 0; attempt += 1) {
      io.stdout(`Repairing validation issues, attempt ${attempt}/${repairAttempts} (${validationIssues.length} issues)...\n`);
      const repairResult = await repairTranslations(units, translations, validationIssues, provider, {
        targetLanguage,
        model,
        glossary,
        characterGlossary,
        batchSize,
        timeoutMs,
        issueCodes: repairCodes,
        onProgress: createProgressLogger(io)
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
    mode: "patch",
    outDir,
    includePlugins: hasFlag(args, "--include-plugins"),
    includeSpeakerNames: hasFlag(args, "--include-speaker-names")
  });
  if (fontPath) {
    io.stdout("Applying font patch...\n");
    await applyFontPatch(projectPath, outDir, { fontPath, numberFontPath });
  }
  io.stdout("Writing translations...\n");
  await writeTranslationResultsFile(path.join(outDir, "translations.json"), translations);
  const report = createReport({ units, translations, validationIssues, engine: detected.engine });
  io.stdout("Writing report...\n");
  await writeReportFile(path.join(outDir, "report.json"), report);
  io.stdout(`${summarizeReport(report)}\n`);
  return 0;
}
