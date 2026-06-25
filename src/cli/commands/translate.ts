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

import { estimateInputTokens, TokenBudget } from "../../core/cost.js";
import { JsonlTranslationMemory } from "../../core/memory/public-api.js";
import { translateWithMemory } from "../../core/memory/public-api.js";
import { createReport } from "../../core/reports/public-api.js";
import {
  appendTranslationResultsJsonlFile,
  readTranslationUnitsFile,
  writeTranslationResultsFile
} from "../../core/translation-units.js";
import { loadGlossary } from "../../config/public-api.js";
import { createProvider } from "../../providers/public-api.js";
import {
  checkpointedTranslationsById,
  checkpointSignature,
  defaultCheckpointPath,
  missingCheckpointResult,
  resolveCheckpoint
} from "../checkpoints.js";
import { maybeWriteReport } from "../file-utils.js";
import {
  assertProviderReady,
  readOption,
  readPositiveIntegerOption,
  readProviderConfig,
  readProviderName,
  readTranslateCliOptions,
  requirePositional
} from "../options/public-api.js";
import { createProgressLogger } from "../progress.js";
import type { TranslationResult } from "../../core/types/types.js";
import type { CliIO } from "../types.js";

export async function translateCommand(args: string[], io: CliIO): Promise<number> {
  const unitsPath = requirePositional(args, 0, "units path");
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
  // Refuse to resume an explicit checkpoint written for a different language,
  // model, provider or glossary; reusing it would ship stale output. A derived
  // checkpoint (no --checkpoint) is reset each run, so it cannot bleed across.
  const checkpointPath = checkpointOption ?? (out ? defaultCheckpointPath(out) : undefined);
  const signature = checkpointSignature(providerName, providerOptions, glossary);
  let checkpointResults: TranslationResult[] = [];
  let staleCheckpoint = false;
  let resumed = false;
  if (checkpointPath) {
    const resolved = await resolveCheckpoint({ checkpointOption, derivedPath: checkpointPath, signature });
    checkpointResults = resolved.results;
    staleCheckpoint = resolved.stale;
    resumed = resolved.resumed;
  }
  const checkpointById = checkpointedTranslationsById(units, checkpointResults);
  const unitsToTranslate = units.filter((unit) => !checkpointById.has(unit.id));
  const tokenBudgetLimit = readPositiveIntegerOption(args, "--max-tokens-budget");
  const budget = tokenBudgetLimit != null ? new TokenBudget(tokenBudgetLimit) : undefined;
  budget?.assertEstimateWithin(estimateInputTokens(unitsToTranslate));
  if (staleCheckpoint) {
    io.stderr("Warning: checkpoint parameters (language/model/glossary) changed; discarding it and translating fresh.\n");
  }
  if (checkpointPath) {
    if (resumed) {
      io.stderr(`Loaded checkpoint: ${checkpointById.size}/${units.length} translated units from ${checkpointPath}\n`);
    }
    io.stderr(`Writing checkpoint: ${checkpointPath}\n`);
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
                io.stderr(`Checkpoint saved: ${batchResults.length} results.\n`);
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
  // A total provider outage (bad key, unreachable endpoint) records every unit as
  // failed but still "completes" each batch. Exit non-zero so a script does not
  // proceed to validate/apply on an empty translation set.
  const translated = results.filter((result) => result.status === "translated").length;
  if (results.length > 0 && translated === 0) {
    io.stderr(`All ${results.length} translation units failed; no translations were produced.\n`);
    return 1;
  }
  return 0;
}
