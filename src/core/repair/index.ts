import type {
  LLMProvider,
  ReviewOptions,
  ReviewUnit,
  TranslationResult,
  TranslationUnit,
  ValidationIssue
} from "../types.js";

export type RepairOptions = ReviewOptions & {
  issueCodes?: ValidationIssue["code"][];
};

export type RepairResult = {
  translations: TranslationResult[];
  repaired: number;
  translated: number;
  reviewed: number;
  failed: number;
  skipped: number;
};

const RETRANSLATE_CODES = new Set<ValidationIssue["code"]>([
  "MISSING_TRANSLATION",
  "EMPTY_TRANSLATION",
  "INVALID_JSON"
]);

export async function repairTranslations(
  units: TranslationUnit[],
  translations: TranslationResult[],
  validationIssues: ValidationIssue[],
  provider: LLMProvider,
  options: RepairOptions
): Promise<RepairResult> {
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  const translationsById = new Map(translations.map((translation) => [translation.id, translation]));
  const selectedIssuesById = selectIssuesById(validationIssues, unitsById, options.issueCodes);
  const toTranslate: TranslationUnit[] = [];
  const toReview: ReviewUnit[] = [];

  for (const [id, issues] of selectedIssuesById.entries()) {
    const unit = unitsById.get(id);
    if (!unit) {
      continue;
    }

    const current = translationsById.get(id);
    if (needsRetranslation(current, issues)) {
      toTranslate.push(unit);
      continue;
    }
    if (!current) {
      continue;
    }

    toReview.push({
      id: unit.id,
      source: unit.source,
      currentTranslation: current.translation,
      normalizedSource: unit.normalizedSource,
      category: unit.category,
      context: unit.context,
      constraints: unit.constraints,
      placeholders: unit.placeholders,
      issues
    });
  }

  const repairedById = new Map<string, TranslationResult>();
  let failed = 0;

  for (const batch of splitBatch(toTranslate, normalizeBatchSize(options.batchSize))) {
    const results = await provider.translateBatch(batch, options);
    for (const result of results) {
      if (result.status === "translated") {
        repairedById.set(result.id, {
          ...result,
          metadata: { ...result.metadata, repaired: true, repairMode: "translate" }
        });
      } else {
        failed += 1;
      }
    }
  }

  let completed = 0;
  const reviewBatches = splitBatch(toReview, normalizeBatchSize(options.batchSize));
  for (const [batchOffset, batch] of reviewBatches.entries()) {
    const batchIndex = batchOffset + 1;
    options.onProgress?.({
      type: "review-batch-start",
      batchIndex,
      batchCount: reviewBatches.length,
      batchSize: batch.length,
      completed,
      total: toReview.length
    });

    const results = await provider.reviewBatch(batch, options);
    for (const result of results) {
      if (result.status === "translated") {
        repairedById.set(result.id, {
          ...result,
          metadata: { ...result.metadata, repaired: true, repairMode: "review" }
        });
      } else {
        failed += 1;
      }
    }
    completed += batch.length;

    options.onProgress?.({
      type: "review-batch-complete",
      batchIndex,
      batchCount: reviewBatches.length,
      batchSize: batch.length,
      reviewed: results.filter((result) => result.status === "translated").length,
      failed: results.filter((result) => result.status === "failed").length,
      completed,
      total: toReview.length
    });
  }

  const originalUnknownTranslations = translations.filter((translation) => !unitsById.has(translation.id));
  const merged = units
    .map((unit) => repairedById.get(unit.id) ?? translationsById.get(unit.id))
    .filter((translation): translation is TranslationResult => translation != null)
    .concat(originalUnknownTranslations);

  return {
    translations: merged,
    repaired: repairedById.size,
    translated: Array.from(repairedById.values()).filter((result) => result.metadata?.repairMode === "translate").length,
    reviewed: Array.from(repairedById.values()).filter((result) => result.metadata?.repairMode === "review").length,
    failed,
    skipped: selectedIssuesById.size - repairedById.size - failed
  };
}

function selectIssuesById(
  validationIssues: ValidationIssue[],
  unitsById: Map<string, TranslationUnit>,
  issueCodes: ValidationIssue["code"][] | undefined
): Map<string, ValidationIssue[]> {
  const codeFilter = issueCodes ? new Set(issueCodes) : undefined;
  const selected = new Map<string, ValidationIssue[]>();

  for (const validationIssue of validationIssues) {
    if (!validationIssue.id || !unitsById.has(validationIssue.id)) {
      continue;
    }
    if (codeFilter && !codeFilter.has(validationIssue.code)) {
      continue;
    }
    const issues = selected.get(validationIssue.id) ?? [];
    issues.push(validationIssue);
    selected.set(validationIssue.id, issues);
  }

  return selected;
}

function needsRetranslation(
  translation: TranslationResult | undefined,
  issues: ValidationIssue[]
): boolean {
  if (!translation || translation.status !== "translated" || translation.translation.trim().length === 0) {
    return true;
  }

  return issues.some((issue) => RETRANSLATE_CODES.has(issue.code));
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
