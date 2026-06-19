import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { MvMzEngineDetector } from "../core/engine-detector/index.js";
import { RpgMakerMvMzExtractor } from "../core/extractors/index.js";
import {
  appendTranslationResultsJsonlFile,
  readTranslationResultsJsonlFile,
  readTranslationResultsFile,
  readTranslationUnitsFile,
  resetTranslationResultsJsonlFile,
  writeTranslationResultsFile,
  writeTranslationUnitsFile
} from "../core/translation-units/index.js";
import { createReport, readReportFile, summarizeReport, writeReportFile } from "../core/reports/index.js";
import {
  DefaultValidator,
  filterTranslationsWithoutValidationErrors,
  validateTranslationResults
} from "../core/validators/index.js";
import { JsonlTranslationMemory, translateWithMemory } from "../core/memory/index.js";
import { applyFontPatch } from "../core/font-patch/index.js";
import { reviewTranslations } from "../core/review/index.js";
import { repairTranslations } from "../core/repair/index.js";
import {
  candidatesToDraftGlossary,
  extractCharacterCandidates,
  inferCharacterGlossary
} from "../core/characters/index.js";
import { createProvider } from "../providers/index.js";
import { loadCharacterGlossary, loadGlossary } from "../config/index.js";
import type { TranslateOptions, TranslationResult, TranslationUnit, ValidationIssue } from "../core/types.js";

export type CliIO = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

export async function runCli(argv: string[], io: CliIO = defaultIO): Promise<number> {
  const [command, ...args] = argv;

  try {
    if (!command || command === "--help" || command === "-h" || command === "help") {
      io.stdout(helpText());
      return 0;
    }

    if (command === "detect") {
      const projectPath = requireArg(args[0], "project path");
      const detected = await new MvMzEngineDetector().detect(projectPath);
      io.stdout(`${JSON.stringify(detected, null, 2)}\n`);
      return 0;
    }

    if (command === "extract") {
      const projectPath = requireArg(args[0], "project path");
      const out = readOption(args, "--out");
      const reportPath = readOption(args, "--report");
      const units = await new RpgMakerMvMzExtractor().extract(projectPath, {
        includeEventComments: hasFlag(args, "--include-comments"),
        includePlugins: hasFlag(args, "--include-plugins"),
        includeSpeakerNames: hasFlag(args, "--include-speaker-names")
      });
      if (out) {
        await writeTranslationUnitsFile(out, units);
      } else {
        io.stdout(`${JSON.stringify(units, null, 2)}\n`);
      }
      await maybeWriteReport(reportPath, createReport({ units }), io);
      return 0;
    }

    if (command === "apply") {
      const projectPath = requireArg(args[0], "project path");
      const translationsPath = requireArg(args[1], "translations path");
      const mode = readOption(args, "--mode") ?? "patch";
      const outDir = readOption(args, "--out");
      const backupDir = readOption(args, "--backup");
      const reportPath = readOption(args, "--report");
      const fontPath = readOption(args, "--font");
      const numberFontPath = readOption(args, "--number-font");
      const translations = await readTranslationResultsFile(translationsPath);
      const translationsToApply = reportPath
        ? filterTranslationsWithoutValidationErrors(translations, (await readReportFile(reportPath)).validationIssues)
        : translations;
      if (reportPath) {
        io.stdout(`Using report filter: ${translationsToApply.length}/${translations.length} validation-safe translations.\n`);
      }
      io.stdout(`Applying translations in ${mode} mode...\n`);
      const result = await new RpgMakerMvMzExtractor().applyTranslations(projectPath, translationsToApply, {
        mode: mode as "patch" | "in-place",
        outDir,
        backupDir,
        includePlugins: hasFlag(args, "--include-plugins"),
        includeSpeakerNames: hasFlag(args, "--include-speaker-names")
      });
      if (mode === "patch" && outDir && fontPath) {
        io.stdout("Applying font patch...\n");
        await applyFontPatch(projectPath, outDir, { fontPath, numberFontPath });
      }
      io.stdout(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    }

    if (command === "patch-font") {
      const projectPath = requireArg(args[0], "project path");
      const outDir = requireOption(args, "--out");
      const fontPath = requireOption(args, "--font");
      const numberFontPath = readOption(args, "--number-font");
      const result = await applyFontPatch(projectPath, outDir, { fontPath, numberFontPath });
      io.stdout(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    }

    if (command === "translate") {
      const unitsPath = requireArg(args[0], "units path");
      const providerName = readOption(args, "--provider") ?? "mock";
      assertProviderReady(providerName);
      const out = readOption(args, "--out");
      const checkpointOption = readOption(args, "--checkpoint");
      const reportPath = readOption(args, "--report");
      const memoryPath = readOption(args, "--memory");
      const glossaryPath = readOption(args, "--glossary");
      const targetLanguage = readOption(args, "--target") ?? "ru";
      const model = readOption(args, "--model");
      const batchSize = readPositiveIntegerOption(args, "--batch-size");
      const retryAttempts = readNonNegativeIntegerOption(args, "--retry-attempts");
      const timeoutMs = readPositiveIntegerOption(args, "--timeout-ms");
      const units = await readTranslationUnitsFile(unitsPath);
      const glossary = glossaryPath ? await loadGlossary(glossaryPath) : undefined;
      const checkpointPath = checkpointOption ?? (out ? defaultCheckpointPath(out) : undefined);
      const checkpointResults = checkpointOption ? await readTranslationResultsJsonlFile(checkpointOption) : [];
      const checkpointById = checkpointedTranslationsById(units, checkpointResults);
      const unitsToTranslate = units.filter((unit) => !checkpointById.has(unit.id));
      if (checkpointPath) {
        if (checkpointOption) {
          io.stdout(`Loaded checkpoint: ${checkpointById.size}/${units.length} translated units from ${checkpointPath}\n`);
        } else {
          await resetTranslationResultsJsonlFile(checkpointPath);
        }
        io.stdout(`Writing checkpoint: ${checkpointPath}\n`);
      }
      const provider = createProvider(providerName);
      const translatedResults = await translateWithMemory(
        unitsToTranslate,
        provider,
        {
          targetLanguage,
          model,
          glossary,
          batchSize,
          retryAttempts,
          timeoutMs,
          onProgress: createProgressLogger(io),
          onBatchResults: checkpointPath
            ? async (batchResults) => {
                await appendTranslationResultsJsonlFile(checkpointPath, batchResults);
                io.stdout(`Checkpoint saved: ${batchResults.length} results.\n`);
              }
            : undefined
        },
        memoryPath ? new JsonlTranslationMemory(memoryPath) : undefined
      );
      const translatedById = new Map(translatedResults.map((result) => [result.id, result]));
      const results = units.map((unit) => translatedById.get(unit.id) ?? checkpointById.get(unit.id) ?? missingCheckpointResult(unit, providerName, model));
      const payload = `${JSON.stringify(results, null, 2)}\n`;
      if (out) {
        await writeTranslationResultsFile(out, results);
      } else {
        io.stdout(payload);
      }
      await maybeWriteReport(reportPath, createReport({ units, translations: results }), io);
      return 0;
    }

    if (command === "review") {
      const unitsPath = requireArg(args[0], "units path");
      const translationsPath = requireArg(args[1], "translations path");
      const providerName = readOption(args, "--provider") ?? "mock";
      assertProviderReady(providerName);
      const out = requireOption(args, "--out");
      const targetLanguage = readOption(args, "--target") ?? "ru";
      const model = readOption(args, "--model");
      const batchSize = readPositiveIntegerOption(args, "--batch-size");
      const timeoutMs = readPositiveIntegerOption(args, "--timeout-ms");
      const glossaryPath = readOption(args, "--glossary");
      const charactersPath = readOption(args, "--characters");
      const units = await readTranslationUnitsFile(unitsPath);
      const translations = await readTranslationResultsFile(translationsPath);
      const glossary = glossaryPath ? await loadGlossary(glossaryPath) : undefined;
      const characterGlossary = charactersPath ? await loadCharacterGlossary(charactersPath) : undefined;
      const result = await reviewTranslations(units, translations, createProvider(providerName), {
        targetLanguage,
        model,
        batchSize,
        timeoutMs,
        glossary,
        characterGlossary,
        onProgress: createProgressLogger(io)
      });
      await writeTranslationResultsFile(out, result.translations);
      io.stdout(`Reviewed: ${result.reviewed}, failed: ${result.failed}, skipped: ${result.skipped}\n`);
      return 0;
    }

    if (command === "repair") {
      const unitsPath = requireArg(args[0], "units path");
      const translationsPath = requireArg(args[1], "translations path");
      const reportPath = requireOption(args, "--report");
      const out = requireOption(args, "--out");
      const providerName = readOption(args, "--provider") ?? "mock";
      assertProviderReady(providerName);
      const targetLanguage = readOption(args, "--target") ?? "ru";
      const model = readOption(args, "--model");
      const batchSize = readPositiveIntegerOption(args, "--batch-size");
      const timeoutMs = readPositiveIntegerOption(args, "--timeout-ms");
      const glossaryPath = readOption(args, "--glossary");
      const charactersPath = readOption(args, "--characters");
      const issueCodes = readIssueCodesOption(args, "--codes");
      const units = await readTranslationUnitsFile(unitsPath);
      const translations = await readTranslationResultsFile(translationsPath);
      const report = await readReportFile(reportPath);
      const glossary = glossaryPath ? await loadGlossary(glossaryPath) : undefined;
      const characterGlossary = charactersPath ? await loadCharacterGlossary(charactersPath) : undefined;
      io.stdout(
        `Repairing translations for ${issueCodes ? issueCodes.join(",") : "all"} validation issue codes...\n`
      );
      const result = await repairTranslations(units, translations, report.validationIssues, createProvider(providerName), {
        targetLanguage,
        model,
        batchSize,
        timeoutMs,
        glossary,
        characterGlossary,
        issueCodes,
        onProgress: createProgressLogger(io)
      });
      await writeTranslationResultsFile(out, result.translations);
      io.stdout(
        `Repaired: ${result.repaired}, translated: ${result.translated}, reviewed: ${result.reviewed}, failed: ${result.failed}, skipped: ${result.skipped}\n`
      );
      return 0;
    }

    if (command === "characters") {
      const unitsPath = requireArg(args[0], "units path");
      const out = requireOption(args, "--out");
      const translationsPath = readOption(args, "--translations");
      const providerName = readOption(args, "--provider") ?? "mock";
      if (providerName !== "none" && !hasFlag(args, "--draft-only")) {
        assertProviderReady(providerName);
      }
      const targetLanguage = readOption(args, "--target") ?? "ru";
      const model = readOption(args, "--model");
      const batchSize = readPositiveIntegerOption(args, "--batch-size");
      const timeoutMs = readPositiveIntegerOption(args, "--timeout-ms");
      const units = await readTranslationUnitsFile(unitsPath);
      const translations = translationsPath ? await readTranslationResultsFile(translationsPath) : [];
      const candidates = extractCharacterCandidates(units, translations, {
        includeDialogueMentions: hasFlag(args, "--include-mentions")
      });
      const glossary =
        providerName === "none" || hasFlag(args, "--draft-only")
          ? candidatesToDraftGlossary(candidates)
          : await inferCharacterGlossary(candidates, createProvider(providerName), {
              targetLanguage,
              model,
              batchSize,
              timeoutMs
            });
      await writeJson(out, glossary);
      io.stdout(`Character candidates: ${candidates.length}. Wrote ${Object.keys(glossary).length} character entries.\n`);
      return 0;
    }

    if (command === "validate") {
      const unitsPath = requireArg(args[0], "units path");
      const translationsPath = requireArg(args[1], "translations path");
      const out = readOption(args, "--out");
      const glossaryPath = readOption(args, "--glossary");
      const units = await readTranslationUnitsFile(unitsPath);
      const translations = await readTranslationResultsFile(translationsPath);
      const glossary = glossaryPath ? await loadGlossary(glossaryPath) : undefined;
      const validationIssues = validateTranslationResults(units, translations, new DefaultValidator(glossary));
      const report = createReport({ units, translations, validationIssues });
      if (out) {
        await writeReportFile(out, report);
        io.stdout(`${summarizeReport(report)}\n`);
      } else {
        io.stdout(`${JSON.stringify(report, null, 2)}\n`);
      }
      return 0;
    }

    if (command === "run") {
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
          io.stdout(
            `Repairing validation issues, attempt ${attempt}/${repairAttempts} (${validationIssues.length} issues)...\n`
          );
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

    io.stderr(`Unknown command: ${command}\n\n${helpText()}`);
    return 1;
  } catch (error: unknown) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

export function helpText(): string {
  return `Usage:
  rpgm-ai-translator --help
  rpgm-ai-translator detect ./game
  rpgm-ai-translator extract ./game --out ./work/units.json [--include-comments] [--include-plugins] [--include-speaker-names] [--report ./work/report.json]
  rpgm-ai-translator translate ./work/units.json --provider mock --out ./work/translations.json [--checkpoint ./work/translations.jsonl] [--batch-size 20] [--retry-attempts 1] [--timeout-ms 60000] [--memory ./work/memory.jsonl] [--glossary ./glossary.json] [--report ./work/report.json]
  rpgm-ai-translator characters ./work/units.json --out ./work/characters.json [--translations ./work/translations.json] [--provider mock|deepseek|none] [--include-mentions]
  rpgm-ai-translator review ./work/units.json ./work/translations.json --provider deepseek --target ru --out ./work/translations.reviewed.json [--characters ./characters.json] [--glossary ./glossary.json]
  rpgm-ai-translator repair ./work/units.json ./work/translations.json --report ./work/report.json --provider deepseek --target ru --out ./work/translations.repaired.json [--codes MAX_LENGTH_EXCEEDED,MISSING_TRANSLATION]
  rpgm-ai-translator validate ./work/units.json ./work/translations.json --out ./work/report.json [--glossary ./glossary.json]
  rpgm-ai-translator apply ./game ./work/translations.json --mode patch --out ./translated-patch [--include-plugins] [--include-speaker-names] [--font ./font.ttf] [--report ./work/report.json]
  rpgm-ai-translator apply ./game ./work/translations.json --mode in-place [--backup ./backup]
  rpgm-ai-translator patch-font ./game --out ./translated-patch --font ./font.ttf [--number-font ./font-bold.ttf]
  rpgm-ai-translator run ./game --provider mock --target ru --out ./translated-patch [--batch-size 20] [--retry-attempts 1] [--timeout-ms 60000] [--glossary ./glossary.json] [--characters ./characters.json] [--review] [--repair] [--repair-attempts 1] [--repair-codes MAX_LENGTH_EXCEEDED,MISSING_TRANSLATION] [--include-plugins] [--include-speaker-names] [--font ./font.ttf]
`;
}

function createProgressLogger(io: CliIO): NonNullable<TranslateOptions["onProgress"]> {
  let memoryHits = 0;
  return (event) => {
    if (event.type === "memory-hit") {
      memoryHits += 1;
      if (memoryHits === 1 || memoryHits % 100 === 0) {
        io.stdout(`Memory hits: ${memoryHits}/${event.total}\n`);
      }
      return;
    }

    if (event.type === "batch-start") {
      io.stdout(
        `Translating batch ${event.batchIndex}/${event.batchCount} (${event.batchSize} units, completed ${event.completed}/${event.total})...\n`
      );
      return;
    }

    if (event.type === "review-batch-start") {
      io.stdout(
        `Reviewing batch ${event.batchIndex}/${event.batchCount} (${event.batchSize} units, completed ${event.completed}/${event.total})...\n`
      );
      return;
    }

    if (event.type === "review-batch-complete") {
      io.stdout(
        `Completed review batch ${event.batchIndex}/${event.batchCount}: reviewed ${event.reviewed}, failed ${event.failed}, completed ${event.completed}/${event.total}\n`
      );
      return;
    }

    if (event.type === "batch-retry") {
      io.stdout(
        `Retrying batch ${event.batchIndex}/${event.batchCount}, attempt ${event.attempt + 1}/${event.maxAttempts}: ${event.message}\n`
      );
      return;
    }

    io.stdout(
      `Completed batch ${event.batchIndex}/${event.batchCount}: translated ${event.translated}, failed ${event.failed}, completed ${event.completed}/${event.total}\n`
    );
  };
}

function assertProviderReady(providerName: string): void {
  if (providerName === "deepseek" && !process.env.DEEPSEEK_API_KEY?.trim()) {
    throw new Error("DEEPSEEK_API_KEY is required when using --provider deepseek");
  }
}

async function maybeWriteReport(
  reportPath: string | undefined,
  report: ReturnType<typeof createReport>,
  io: CliIO
): Promise<void> {
  if (!reportPath) {
    return;
  }

  await writeReportFile(reportPath, report);
  io.stdout(`${summarizeReport(report)}\n`);
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function readPositiveIntegerOption(args: string[], name: string): number | undefined {
  const value = readOption(args, name);
  if (value == null) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function readNonNegativeIntegerOption(args: string[], name: string): number | undefined {
  const value = readOption(args, name);
  if (value == null) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function readIssueCodesOption(args: string[], name: string): ValidationIssue["code"][] | undefined {
  const value = readOption(args, name);
  if (value == null) {
    return undefined;
  }

  const codes = value
    .split(",")
    .map((code) => code.trim())
    .filter((code) => code.length > 0);
  for (const code of codes) {
    if (!isValidationIssueCode(code)) {
      throw new Error(`${name} contains unknown validation issue code '${code}'`);
    }
  }
  return codes as ValidationIssue["code"][];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function requireArg(value: string | undefined, label: string): string {
  if (!value) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}

function requireOption(args: string[], name: string): string {
  const value = readOption(args, name);
  if (!value) {
    throw new Error(`Missing required option ${name}`);
  }
  return value;
}

function defaultCheckpointPath(outPath: string): string {
  return outPath.endsWith(".json") ? `${outPath.slice(0, -".json".length)}.jsonl` : `${outPath}.jsonl`;
}

function checkpointedTranslationsById(
  units: TranslationUnit[],
  checkpointResults: TranslationResult[]
): Map<string, TranslationResult> {
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  const resultsById = new Map<string, TranslationResult>();

  for (const result of checkpointResults) {
    const unit = unitsById.get(result.id);
    if (!unit || result.status !== "translated" || result.source !== unit.source) {
      continue;
    }
    resultsById.set(result.id, { ...result, metadata: { ...result.metadata, fromCheckpoint: true } });
  }

  return resultsById;
}

function missingCheckpointResult(
  unit: TranslationUnit,
  providerName: string,
  model: string | undefined
): TranslationResult {
  return {
    id: unit.id,
    source: unit.source,
    translation: "",
    provider: providerName,
    model: model ?? "unknown",
    status: "failed",
    issues: [
      {
        id: unit.id,
        severity: "error",
        code: "MISSING_TRANSLATION",
        message: "Translation was not produced"
      }
    ]
  };
}

function isValidationIssueCode(value: string): value is ValidationIssue["code"] {
  return VALIDATION_ISSUE_CODES.has(value as ValidationIssue["code"]);
}

const VALIDATION_ISSUE_CODES = new Set<ValidationIssue["code"]>([
  "INVALID_JSON",
  "ID_MISMATCH",
  "UNKNOWN_TRANSLATION_ID",
  "MISSING_TRANSLATION",
  "MISSING_PLACEHOLDER",
  "EXTRA_PLACEHOLDER",
  "DUPLICATE_PLACEHOLDER",
  "CONTROL_CODE_CHANGED",
  "NUMBER_CHANGED",
  "VARIABLE_CHANGED",
  "MAX_LENGTH_EXCEEDED",
  "MAX_LINES_EXCEEDED",
  "EMPTY_TRANSLATION",
  "UNCHANGED_TRANSLATION",
  "GLOSSARY_VIOLATION",
  "TECHNICAL_TOKEN_CHANGED"
]);

const defaultIO: CliIO = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text)
};
