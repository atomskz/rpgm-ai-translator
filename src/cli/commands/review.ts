import { reviewTranslations } from "../../core/review/index.js";
import {
  appendTranslationResultsJsonlFile,
  readTranslationResultsJsonlFile,
  readTranslationResultsFile,
  readTranslationUnitsFile,
  resetTranslationResultsJsonlFile,
  writeTranslationResultsFile
} from "../../core/translation-units/index.js";
import { loadCharacterGlossary, loadGlossary } from "../../config/index.js";
import { createProvider } from "../../providers/index.js";
import {
  checkpointedTranslationsById,
  defaultCheckpointPath,
  mergeCheckpointTranslations
} from "../checkpoints.js";
import {
  assertProviderReady,
  readNumberOption,
  readOption,
  readPositiveIntegerOption,
  requireArg,
  requireOption
} from "../options.js";
import { createProgressLogger } from "../progress.js";
import type { CliIO } from "../types.js";

export async function reviewCommand(args: string[], io: CliIO): Promise<number> {
  const unitsPath = requireArg(args[0], "units path");
  const translationsPath = requireArg(args[1], "translations path");
  const providerName = readOption(args, "--provider") ?? "mock";
  assertProviderReady(providerName);
  const out = requireOption(args, "--out");
  const checkpointOption = readOption(args, "--checkpoint");
  const targetLanguage = readOption(args, "--target") ?? "ru";
  const model = readOption(args, "--model");
  const batchSize = readPositiveIntegerOption(args, "--batch-size");
  const timeoutMs = readPositiveIntegerOption(args, "--timeout-ms");
  const temperature = readNumberOption(args, "--temperature", { min: 0, max: 2 });
  const maxTokens = readPositiveIntegerOption(args, "--max-tokens");
  const glossaryPath = readOption(args, "--glossary");
  const charactersPath = readOption(args, "--characters");
  const units = await readTranslationUnitsFile(unitsPath);
  const translations = await readTranslationResultsFile(translationsPath);
  const glossary = glossaryPath ? await loadGlossary(glossaryPath) : undefined;
  const characterGlossary = charactersPath ? await loadCharacterGlossary(charactersPath) : undefined;
  const checkpointPath = checkpointOption ?? defaultCheckpointPath(out);
  const checkpointResults = checkpointOption ? await readTranslationResultsJsonlFile(checkpointOption) : [];
  const checkpointById = checkpointedTranslationsById(units, checkpointResults);
  const unitsToReview = units.filter((unit) => !checkpointById.has(unit.id));
  const translationsWithCheckpoint = mergeCheckpointTranslations(units, translations, checkpointById);
  if (checkpointOption) {
    io.stdout(`Loaded review checkpoint: ${checkpointById.size}/${units.length} translated units from ${checkpointPath}\n`);
  } else {
    await resetTranslationResultsJsonlFile(checkpointPath);
  }
  io.stdout(`Writing review checkpoint: ${checkpointPath}\n`);
  const result = await reviewTranslations(unitsToReview, translationsWithCheckpoint, createProvider(providerName), {
    targetLanguage,
    model,
    batchSize,
    timeoutMs,
    temperature,
    maxTokens,
    glossary,
    characterGlossary,
    onProgress: createProgressLogger(io),
    onBatchResults: async (batchResults) => {
      await appendTranslationResultsJsonlFile(checkpointPath, batchResults);
      io.stdout(`Review checkpoint saved: ${batchResults.length} results.\n`);
    }
  });
  await writeTranslationResultsFile(out, result.translations);
  io.stdout(`Reviewed: ${result.reviewed}, failed: ${result.failed}, skipped: ${result.skipped}\n`);
  return 0;
}
