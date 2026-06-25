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

const DEFAULT_BATCH_SIZE = 20;

export function normalizeBatchSize(batchSize: number | undefined, fallback = DEFAULT_BATCH_SIZE): number {
  if (batchSize == null || !Number.isFinite(batchSize) || batchSize < 1) {
    return fallback;
  }
  return Math.floor(batchSize);
}

// Splits into batches, normalizing the raw size itself so callers pass the
// option value directly instead of pre-normalizing it (which double-normalized).
export function splitBatch<T>(items: T[], batchSize: number | undefined): T[][] {
  const normalizedBatchSize = normalizeBatchSize(batchSize);
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += normalizedBatchSize) {
    batches.push(items.slice(index, index + normalizedBatchSize));
  }
  return batches;
}
