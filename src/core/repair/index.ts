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

import type {
  LLMProvider,
  ReviewOptions,
  ReviewUnit,
  TranslationResult,
  TranslationUnit,
  ValidationIssue
} from "../types.js";
import { normalizeBatchSize, splitBatch } from "../batching/index.js";
import { withProviderRetry } from "../retry/index.js";
import { DefaultValidator, introducedErrorCode } from "../validators/index.js";

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
  const validator = new DefaultValidator(options.glossary);

  // Reject a repaired translation that introduces a validation error which was not
  // already present, so a repair pass can never ship a freshly broken translation.
  // Returns a failed result (keeping the previous text) on regression, else undefined.
  const rejectIfRegressed = (repaired: TranslationResult): TranslationResult | undefined => {
    const unit = unitsById.get(repaired.id);
    if (!unit) {
      return undefined;
    }
    const current = translationsById.get(repaired.id);
    const introduced = introducedErrorCode(unit, current, repaired, validator, selectedIssuesById.get(repaired.id) ?? []);
    if (!introduced) {
      return undefined;
    }
    return {
      id: unit.id,
      source: unit.source,
      translation: current?.translation ?? "",
      provider: provider.name,
      model: options.model ?? "unknown",
      status: "failed",
      issues: [
        {
          id: unit.id,
          severity: "error",
          code: introduced,
          message: `Repair introduced ${introduced}; kept the previous translation`
        }
      ]
    };
  };
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
    let results: TranslationResult[];
    try {
      results = await withProviderRetry(() => provider.translateBatch(batch, options), options);
    } catch (error: unknown) {
      results = failedRepairTranslateBatch(batch, provider, options, error);
    }
    const checkpointResults: TranslationResult[] = [];
    for (const result of results) {
      if (result.status === "translated") {
        const repaired = {
          ...result,
          metadata: { ...result.metadata, repaired: true, repairMode: "translate" as const }
        };
        const rejected = rejectIfRegressed(repaired);
        if (rejected) {
          failed += 1;
          checkpointResults.push(rejected);
          continue;
        }
        repairedById.set(result.id, repaired);
        checkpointResults.push(repaired);
      } else {
        failed += 1;
        checkpointResults.push(result);
      }
    }
    await options.onBatchResults?.(checkpointResults);
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

    let results: TranslationResult[];
    try {
      results = await withProviderRetry(() => provider.reviewBatch(batch, options), options);
    } catch (error: unknown) {
      results = failedRepairReviewBatch(batch, provider, options, error);
    }
    const checkpointResults: TranslationResult[] = [];
    for (const result of results) {
      if (result.status === "translated") {
        const repaired = {
          ...result,
          metadata: { ...result.metadata, repaired: true, repairMode: "review" as const }
        };
        const rejected = rejectIfRegressed(repaired);
        if (rejected) {
          failed += 1;
          checkpointResults.push(rejected);
          continue;
        }
        repairedById.set(result.id, repaired);
        checkpointResults.push(repaired);
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

function failedRepairTranslateBatch(
  batch: TranslationUnit[],
  provider: LLMProvider,
  options: RepairOptions,
  error: unknown
): TranslationResult[] {
  const message = error instanceof Error ? error.message : String(error);
  return batch.map((unit) => ({
    id: unit.id,
    source: unit.source,
    translation: "",
    provider: provider.name,
    model: options.model ?? "unknown",
    status: "failed" as const,
    issues: [
      {
        id: unit.id,
        severity: "error" as const,
        code: "PROVIDER_RESPONSE_ERROR" as const,
        message: `Repair batch failed: ${message}`
      }
    ]
  }));
}

function failedRepairReviewBatch(
  batch: ReviewUnit[],
  provider: LLMProvider,
  options: RepairOptions,
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
        message: `Repair batch failed: ${message}`
      }
    ],
    metadata: { reviewed: false }
  }));
}
