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

import type { LLMProvider } from "../ports/public-api.js";
import type {
  ReviewOptions,
  ReviewUnit,
  TranslationCategory,
  TranslationResult,
  TranslationUnit,
  ValidationIssue
} from "../types/public-api.js";
import { splitBatch } from "../batching.js";
import { summarizeBatchFailures } from "../reports/public-api.js";
import { isRetryableProviderError, withProviderRetry } from "../retry.js";
import { collectRevalidatedBatch } from "./revalidation.js";
import { DefaultValidator, introducedErrorCode } from "../validators/public-api.js";

export type ReviewPassResult = {
  translations: TranslationResult[];
  reviewed: number;
  failed: number;
  skipped: number;
};

const DEFAULT_REVIEW_CATEGORIES: TranslationCategory[] = ["dialogue", "choice"];

export async function reviewTranslations(
  units: TranslationUnit[],
  translations: TranslationResult[],
  provider: LLMProvider,
  options: ReviewOptions
): Promise<ReviewPassResult> {
  const translationById = new Map(translations.map((translation) => [translation.id, translation]));
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  const validator = new DefaultValidator(options.glossary);
  const reviewCategories = new Set(options.reviewCategories ?? DEFAULT_REVIEW_CATEGORIES);
  const candidates = units
    .filter((unit) => reviewCategories.has(unit.category))
    .map((unit) => toReviewUnit(unit, translationById.get(unit.id)))
    .filter((unit): unit is ReviewUnit => unit != null);

  const reviewedById = new Map<string, TranslationResult>();
  let failed = 0;
  let completed = 0;
  const batches = groupReviewUnits(candidates).flatMap((group) => splitBatch(group, options.batchSize));

  for (const [batchOffset, batch] of batches.entries()) {
    const batchIndex = batchOffset + 1;
    options.onProgress?.({
      type: "review-batch-start",
      batchIndex,
      batchCount: batches.length,
      batchSize: batch.length,
      completed,
      total: candidates.length
    });

    let reviewed: TranslationResult[];
    try {
      reviewed = await withProviderRetry(() => provider.reviewBatch(batch, options), {
        retryAttempts: options.retryAttempts,
        retryDelayMs: options.retryDelayMs,
        isRetryable: isRetryableProviderError
      });
    } catch (error: unknown) {
      reviewed = failedReviewBatch(batch, provider, options, error);
    }
    const { checkpointResults, failed: batchFailed } = collectRevalidatedBatch(
      reviewed,
      new Set(batch.map((unit) => unit.id)),
      reviewedById,
      (result) => mergeReviewResult(translationById.get(result.id), result),
      (merged) => {
        const unit = unitsById.get(merged.id);
        const current = translationById.get(merged.id);
        const introduced = unit ? introducedErrorCode(unit, current, merged, validator) : undefined;
        // The review made the translation worse; keep the pre-review text.
        return introduced ? regressedReviewResult(merged, current, introduced) : undefined;
      }
    );
    failed += batchFailed;
    await options.onBatchResults?.(checkpointResults);
    completed += batch.length;

    options.onProgress?.({
      type: "review-batch-complete",
      batchIndex,
      batchCount: batches.length,
      batchSize: batch.length,
      reviewed: reviewed.filter((result) => result.status === "translated").length,
      failed: reviewed.filter((result) => result.status === "failed").length,
      completed,
      total: candidates.length,
      failures: summarizeBatchFailures(reviewed)
    });
  }

  return {
    translations: translations.map((translation) => {
      return reviewedById.get(translation.id) ?? translation;
    }),
    reviewed: reviewedById.size,
    failed,
    skipped: translations.length - reviewedById.size - failed
  };
}

// Fold a reviewed result onto the previous translation, keeping the prior
// metadata, replacing the text/provider/model/status/issues with the review's,
// and marking it reviewed.
function mergeReviewResult(current: TranslationResult | undefined, result: TranslationResult): TranslationResult {
  return {
    ...current,
    ...result,
    translation: result.translation,
    provider: result.provider,
    model: result.model,
    status: result.status,
    issues: result.issues,
    metadata: { ...current?.metadata, ...result.metadata, reviewed: true }
  };
}

function regressedReviewResult(
  result: TranslationResult,
  current: TranslationResult | undefined,
  introduced: ValidationIssue["code"]
): TranslationResult {
  return {
    id: result.id,
    source: result.source,
    translation: current?.translation ?? result.translation,
    provider: current?.provider ?? result.provider,
    model: current?.model ?? result.model,
    status: "failed",
    issues: [
      {
        id: result.id,
        severity: "error",
        code: introduced,
        message: `Review introduced ${introduced}; kept the previous translation`
      }
    ],
    metadata: { reviewed: false }
  };
}

function toReviewUnit(unit: TranslationUnit, translation: TranslationResult | undefined): ReviewUnit | undefined {
  if (!translation || translation.status !== "translated" || translation.translation.trim().length === 0) {
    return undefined;
  }

  return {
    id: unit.id,
    source: unit.source,
    currentTranslation: translation.translation,
    normalizedSource: unit.normalizedSource,
    category: unit.category,
    context: unit.context,
    constraints: unit.constraints,
    placeholders: unit.placeholders
  };
}

function groupReviewUnits(units: ReviewUnit[]): ReviewUnit[][] {
  const groups = new Map<string, ReviewUnit[]>();
  for (const unit of units) {
    const key = [
      unit.context?.mapName ?? "",
      unit.context?.eventId ?? "",
      unit.context?.eventName ?? "",
      inferFileKey(unit.id)
    ].join("|");
    const group = groups.get(key) ?? [];
    group.push(unit);
    groups.set(key, group);
  }
  return Array.from(groups.values());
}

function inferFileKey(id: string): string {
  return id.split(".").slice(0, 1).join(".");
}

function failedReviewBatch(
  batch: ReviewUnit[],
  provider: LLMProvider,
  options: ReviewOptions,
  error: unknown
): TranslationResult[] {
  const message = error instanceof Error ? error.message : String(error);
  return batch.map((unit) => ({
    id: unit.id,
    source: unit.source,
    translation: unit.currentTranslation,
    provider: provider.name,
    model: options.model ?? "unknown",
    status: "failed" as const,
    issues: [
      {
        id: unit.id,
        severity: "error" as const,
        code: "PROVIDER_RESPONSE_ERROR" as const,
        message: `Review batch failed: ${message}`
      }
    ],
    metadata: { reviewed: false }
  }));
}
