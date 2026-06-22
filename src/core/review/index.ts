import type {
  LLMProvider,
  ReviewOptions,
  ReviewUnit,
  TranslationCategory,
  TranslationResult,
  TranslationUnit,
  ValidationIssue
} from "../types.js";
import { normalizeBatchSize, splitBatch } from "../batching/index.js";
import { withProviderRetry } from "../retry/index.js";
import { DefaultValidator, introducedErrorCode } from "../validators/index.js";

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
  const batches = groupReviewUnits(candidates).flatMap((group) => splitBatch(group, normalizeBatchSize(options.batchSize)));

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
      reviewed = await withProviderRetry(() => provider.reviewBatch(batch, options), options);
    } catch (error: unknown) {
      reviewed = failedReviewBatch(batch, provider, options, error);
    }
    const checkpointResults: TranslationResult[] = [];
    for (const result of reviewed) {
      if (result.status === "translated") {
        const current = translationById.get(result.id);
        const merged = {
          ...current,
          ...result,
          translation: result.translation,
          provider: result.provider,
          model: result.model,
          status: result.status,
          issues: result.issues,
          metadata: { ...current?.metadata, ...result.metadata, reviewed: true }
        };
        const unit = unitsById.get(result.id);
        const introduced = unit ? introducedErrorCode(unit, current, merged, validator) : undefined;
        if (introduced) {
          // The review made the translation worse; keep the pre-review text.
          failed += 1;
          checkpointResults.push(regressedReviewResult(result, current, introduced));
          continue;
        }
        reviewedById.set(result.id, merged);
        checkpointResults.push(merged);
      } else {
        failed += 1;
        checkpointResults.push(result);
      }
    }
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
      total: candidates.length
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
