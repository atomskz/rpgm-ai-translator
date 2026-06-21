import { withRetry } from "../retry/index.js";
import type { LLMProvider, TranslateOptions, TranslationResult, TranslationUnit } from "../types.js";

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
