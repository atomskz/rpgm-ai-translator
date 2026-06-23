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

import { estimateInputTokens, TokenBudget } from "../../core/cost/index.js";
import { JsonlTranslationMemory, translateWithMemory } from "../../core/memory/index.js";
import { createReport } from "../../core/reports/index.js";
import {
  appendTranslationResultsJsonlFile,
  readTranslationResultsJsonlFile,
  readTranslationUnitsFile,
  resetTranslationResultsJsonlFile,
  writeTranslationResultsFile
} from "../../core/translation-units/index.js";
import { loadGlossary } from "../../config/index.js";
import { createProvider } from "../../providers/index.js";
import {
  checkpointedTranslationsById,
  defaultCheckpointPath,
  missingCheckpointResult
} from "../checkpoints.js";
import { maybeWriteReport } from "../file-utils.js";
import {
  assertProviderReady,
  readOption,
  readPositiveIntegerOption,
  readProviderConfig,
  readProviderName,
  readTranslateCliOptions,
  requireArg
} from "../options.js";
import { createProgressLogger } from "../progress.js";
import type { CliIO } from "../types.js";

export async function translateCommand(args: string[], io: CliIO): Promise<number> {
  const unitsPath = requireArg(args[0], "units path");
  const providerName = readProviderName(args);
  assertProviderReady(providerName);
  const providerOptions = readTranslateCliOptions(args);
  const out = readOption(args, "--out");
  const checkpointOption = readOption(args, "--checkpoint");
  const reportPath = readOption(args, "--report");
  const memoryPath = readOption(args, "--memory");
  const glossaryPath = readOption(args, "--glossary");
  const units = await readTranslationUnitsFile(unitsPath);
  const glossary = glossaryPath ? await loadGlossary(glossaryPath) : undefined;
  const checkpointPath = checkpointOption ?? (out ? defaultCheckpointPath(out) : undefined);
  const checkpointResults = checkpointOption ? await readTranslationResultsJsonlFile(checkpointOption) : [];
  const checkpointById = checkpointedTranslationsById(units, checkpointResults);
  const unitsToTranslate = units.filter((unit) => !checkpointById.has(unit.id));
  const tokenBudgetLimit = readPositiveIntegerOption(args, "--max-tokens-budget");
  const budget = tokenBudgetLimit != null ? new TokenBudget(tokenBudgetLimit) : undefined;
  budget?.assertEstimateWithin(estimateInputTokens(unitsToTranslate));
  if (checkpointPath) {
    if (checkpointOption) {
      io.stdout(`Loaded checkpoint: ${checkpointById.size}/${units.length} translated units from ${checkpointPath}\n`);
    } else {
      await resetTranslationResultsJsonlFile(checkpointPath);
    }
    io.stdout(`Writing checkpoint: ${checkpointPath}\n`);
  }
  const provider = createProvider(providerName, readProviderConfig(args));
  const translatedResults = await translateWithMemory(
    unitsToTranslate,
    provider,
    {
      ...providerOptions,
      glossary,
      onProgress: createProgressLogger(io),
      onBatchResults:
        checkpointPath || budget
          ? async (batchResults) => {
              if (checkpointPath) {
                await appendTranslationResultsJsonlFile(checkpointPath, batchResults);
                io.stdout(`Checkpoint saved: ${batchResults.length} results.\n`);
              }
              budget?.record(batchResults);
              budget?.assertWithin();
            }
          : undefined
    },
    memoryPath ? new JsonlTranslationMemory(memoryPath) : undefined
  );
  const translatedById = new Map(translatedResults.map((result) => [result.id, result]));
  const results = units.map(
    (unit) =>
      translatedById.get(unit.id) ??
      checkpointById.get(unit.id) ??
      missingCheckpointResult(unit, providerName, providerOptions.model)
  );
  const payload = `${JSON.stringify(results, null, 2)}\n`;
  if (out) {
    await writeTranslationResultsFile(out, results);
  } else {
    io.stdout(payload);
  }
  await maybeWriteReport(reportPath, createReport({ units, translations: results }), io);
  return 0;
}
