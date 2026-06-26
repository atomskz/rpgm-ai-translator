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

import { normalizeBatchSize } from "../../core/batching.js";
import { estimateInputTokens, estimateTotalTokens } from "../../core/cost.js";
import { readTranslationUnitsFile } from "../../core/translation-units.js";
import { readNumberOption, readPositiveIntegerOption, requirePositional } from "../options/public-api.js";
import type { CliIO } from "../types.js";

// Estimate the cost of translating a units file without committing to a run: the
// batch count, input tokens, and a total-token estimate (with an optional USD
// band), so a translator can size a job up front.
export async function estimateCommand(args: string[], io: CliIO): Promise<number> {
  const unitsPath = requirePositional(args, 0, "units path");
  const batchSizeOption = readPositiveIntegerOption(args, "--batch-size");
  const price = readNumberOption(args, "--price-per-1k", { min: 0 });

  const units = await readTranslationUnitsFile(unitsPath);
  const batches = Math.ceil(units.length / normalizeBatchSize(batchSizeOption));
  const inputTokens = estimateInputTokens(units);
  const totalTokens = estimateTotalTokens(units, { batchSize: batchSizeOption });

  const report: Record<string, unknown> = {
    units: units.length,
    batches: units.length === 0 ? 0 : batches,
    inputTokens,
    estimatedTotalTokens: totalTokens
  };
  if (price != null) {
    // The estimate is approximate, so quote a band (half to double) instead of a
    // single misleadingly-precise figure.
    const usd = (totalTokens / 1000) * price;
    report.estimatedUsdLow = Number((usd / 2).toFixed(4));
    report.estimatedUsdHigh = Number((usd * 2).toFixed(4));
  }

  io.stdout(`${JSON.stringify(report, null, 2)}\n`);
  io.stderr(
    `${units.length} units in ${report.batches} batch(es); ~${inputTokens} input tokens, ~${totalTokens} total tokens` +
      `${price != null ? ` (~$${report.estimatedUsdLow}–$${report.estimatedUsdHigh})` : ""}.\n`
  );
  return 0;
}
