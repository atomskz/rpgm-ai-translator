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

import { isRetryableProviderError, withRetry } from "../retry.js";
import type { LLMProvider, TranslateOptions, TranslationResult, TranslationUnit } from "../types/types.js";

export async function translateBatchWithRetry(
  batch: TranslationUnit[],
  provider: LLMProvider,
  options: TranslateOptions,
  batchIndex: number,
  batchCount: number
): Promise<TranslationResult[]> {
  try {
    return await withRetry(() => provider.translateBatch(batch, options), {
      retryAttempts: options.retryAttempts,
      retryDelayMs: options.retryDelayMs,
      isRetryable: isRetryableProviderError,
      onRetry: ({ error, retryIndex, maxAttempts }) => {
        options.onProgress?.({
          type: "batch-retry",
          batchIndex,
          batchCount,
          attempt: retryIndex,
          maxAttempts,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    });
  } catch (error: unknown) {
    return failedBatchResults(batch, provider, options, error);
  }
}

function failedBatchResults(
  batch: TranslationUnit[],
  provider: LLMProvider,
  options: TranslateOptions,
  error: unknown
): TranslationResult[] {
  const message = error instanceof Error ? error.message : String(error);
  return batch.map((unit) => ({
    id: unit.id,
    source: unit.source,
    translation: "",
    provider: provider.name,
    model: options.model ?? "unknown",
    status: "failed",
    issues: [
      {
        id: unit.id,
        severity: "error",
        code: "MISSING_TRANSLATION",
        message: `Translation batch failed: ${message}`
      }
    ]
  }));
}
