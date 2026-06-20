import { repairTranslations } from "../../core/repair/index.js";
import { readReportFile } from "../../core/reports/index.js";
import {
  appendTranslationResultsJsonlFile,
  readTranslationResultsJsonlFile,
  readTranslationResultsFile,
  readTranslationUnitsFile,
  resetTranslationResultsJsonlFile,
  writeTranslationResultsFile
} from "../../core/translation-units/index.js";
import { DefaultValidator, validateTranslationResults } from "../../core/validators/index.js";
import { loadCharacterGlossary, loadGlossary } from "../../config/index.js";
import { createProvider } from "../../providers/index.js";
import {
  checkpointedTranslationsById,
  defaultCheckpointPath,
  mergeCheckpointTranslations
} from "../checkpoints.js";
import {
  assertProviderReady,
  readIssueCodesOption,
  readNumberOption,
  readOption,
  readPositiveIntegerOption,
  requireArg,
  requireOption
} from "../options.js";
import { createProgressLogger } from "../progress.js";
import type { TranslationResult, ValidationIssue } from "../../core/types.js";
import type { CliIO } from "../types.js";

export async function repairCommand(args: string[], io: CliIO): Promise<number> {
  const unitsPath = requireArg(args[0], "units path");
  const translationsPath = requireArg(args[1], "translations path");
  const reportPath = requireOption(args, "--report");
  const out = requireOption(args, "--out");
  const providerName = readOption(args, "--provider") ?? "mock";
  assertProviderReady(providerName);
  const checkpointOption = readOption(args, "--checkpoint");
  const targetLanguage = readOption(args, "--target") ?? "ru";
  const model = readOption(args, "--model");
  const batchSize = readPositiveIntegerOption(args, "--batch-size");
  const timeoutMs = readPositiveIntegerOption(args, "--timeout-ms");
  const temperature = readNumberOption(args, "--temperature", { min: 0, max: 2 });
  const maxTokens = readPositiveIntegerOption(args, "--max-tokens");
  const glossaryPath = readOption(args, "--glossary");
  const charactersPath = readOption(args, "--characters");
  const issueCodes = readIssueCodesOption(args, "--codes");
  const attempts = readPositiveIntegerOption(args, "--attempts") ?? 1;
  const units = await readTranslationUnitsFile(unitsPath);
  let translations = await readTranslationResultsFile(translationsPath);
  const report = await readReportFile(reportPath);
  const glossary = glossaryPath ? await loadGlossary(glossaryPath) : undefined;
  const characterGlossary = charactersPath ? await loadCharacterGlossary(charactersPath) : undefined;
  const checkpointPath = checkpointOption ?? defaultCheckpointPath(out);
  const checkpointResults = checkpointOption ? await readTranslationResultsJsonlFile(checkpointOption) : [];
  const checkpointById = checkpointedTranslationsById(units, checkpointResults);
  if (checkpointById.size > 0) {
    translations = mergeCheckpointTranslations(units, translations, checkpointById);
  }
  if (checkpointOption) {
    io.stdout(`Loaded repair checkpoint: ${checkpointById.size}/${units.length} translated units from ${checkpointPath}\n`);
  } else {
    await resetTranslationResultsJsonlFile(checkpointPath);
  }
  io.stdout(`Writing repair checkpoint: ${checkpointPath}\n`);
  io.stdout(`Repairing translations for ${issueCodes ? issueCodes.join(",") : "all"} validation issue codes...\n`);
  let validationIssues = filterValidationIssues(report.validationIssues, issueCodes, checkpointById);
  let repaired = 0;
  let translated = 0;
  let reviewed = 0;
  let failed = 0;
  let skipped = 0;
  const provider = createProvider(providerName);
  for (let attempt = 1; attempt <= attempts && validationIssues.length > 0; attempt += 1) {
    io.stdout(`Repair attempt ${attempt}/${attempts}: ${validationIssues.length} targeted issues...\n`);
    const result = await repairTranslations(units, translations, validationIssues, provider, {
      targetLanguage,
      model,
      batchSize,
      timeoutMs,
      temperature,
      maxTokens,
      glossary,
      characterGlossary,
      issueCodes,
      onProgress: createProgressLogger(io),
      onBatchResults: async (batchResults) => {
        await appendTranslationResultsJsonlFile(checkpointPath, batchResults);
        io.stdout(`Repair checkpoint saved: ${batchResults.length} results.\n`);
      }
    });
    translations = result.translations;
    repaired += result.repaired;
    translated += result.translated;
    reviewed += result.reviewed;
    failed += result.failed;
    skipped += result.skipped;
    io.stdout(
      `Repair attempt ${attempt}/${attempts}: repaired ${result.repaired}, translated ${result.translated}, reviewed ${result.reviewed}, failed ${result.failed}, skipped ${result.skipped}\n`
    );
    if (result.repaired === 0) {
      break;
    }
    const currentIssues = validateTranslationResults(units, translations, new DefaultValidator(glossary));
    validationIssues = filterValidationIssues(currentIssues, issueCodes, new Map());
  }
  await writeTranslationResultsFile(out, translations);
  io.stdout(
    `Repaired: ${repaired}, translated: ${translated}, reviewed: ${reviewed}, failed: ${failed}, skipped: ${skipped}, remaining targeted issues: ${validationIssues.length}\n`
  );
  return 0;
}

function filterValidationIssues(
  validationIssues: ValidationIssue[],
  issueCodes: ValidationIssue["code"][] | undefined,
  skippedTranslationsById: Map<string, TranslationResult>
): ValidationIssue[] {
  const codeFilter = issueCodes ? new Set(issueCodes) : undefined;
  return validationIssues.filter((issue) => {
    if (issue.id && skippedTranslationsById.has(issue.id)) {
      return false;
    }
    return !codeFilter || codeFilter.has(issue.code);
  });
}
