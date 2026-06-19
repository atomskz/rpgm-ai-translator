import type {
  LLMProvider,
  ReviewOptions,
  ReviewUnit,
  TranslationCategory,
  TranslationResult,
  TranslationUnit
} from "../types.js";

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

    const reviewed = await provider.reviewBatch(batch, options);
    for (const result of reviewed) {
      if (result.status === "translated") {
        reviewedById.set(result.id, result);
      } else {
        failed += 1;
      }
    }
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
      const reviewed = reviewedById.get(translation.id);
      return reviewed
        ? {
            ...translation,
            translation: reviewed.translation,
            provider: reviewed.provider,
            model: reviewed.model,
            status: reviewed.status,
            issues: reviewed.issues,
            metadata: { ...translation.metadata, ...reviewed.metadata, reviewed: true }
          }
        : translation;
    }),
    reviewed: reviewedById.size,
    failed,
    skipped: translations.length - reviewedById.size - failed
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

function splitBatch<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += batchSize) {
    batches.push(items.slice(index, index + batchSize));
  }
  return batches;
}

function normalizeBatchSize(batchSize: number | undefined): number {
  if (batchSize == null || !Number.isFinite(batchSize) || batchSize < 1) {
    return 20;
  }
  return Math.floor(batchSize);
}
