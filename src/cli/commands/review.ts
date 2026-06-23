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
  readOption,
  readProviderCliOptions,
  readProviderConfig,
  readProviderName,
  requireOption,
  requirePositional
} from "../options.js";
import { createProgressLogger } from "../progress.js";
import type { CliIO } from "../types.js";

export async function reviewCommand(args: string[], io: CliIO): Promise<number> {
  const unitsPath = requirePositional(args, 0, "units path");
  const translationsPath = requirePositional(args, 1, "translations path");
  const providerName = readProviderName(args);
  assertProviderReady(providerName);
  const providerOptions = readProviderCliOptions(args);
  const out = requireOption(args, "--out");
  const checkpointOption = readOption(args, "--checkpoint");
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
  const result = await reviewTranslations(unitsToReview, translationsWithCheckpoint, createProvider(providerName, readProviderConfig(args)), {
    ...providerOptions,
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
