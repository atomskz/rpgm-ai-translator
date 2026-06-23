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
  CharacterCandidate,
  CharacterGlossary,
  ProviderUsage,
  ReviewUnit,
  TokenUsage,
  TranslationResult,
  TranslationUnit,
  ValidationIssue
} from "../../core/types.js";
import { DeepSeekProviderError, providerIssue } from "./errors.js";
import type { ChatCompletionResponse, ModelTranslationPayload } from "./types.js";

// Map DeepSeek's OpenAI-shaped usage payload to the provider-neutral TokenUsage.
function toTokenUsage(usage: ProviderUsage | undefined): TokenUsage | undefined {
  if (!usage) {
    return undefined;
  }
  const tokenUsage: TokenUsage = {};
  if (typeof usage.prompt_tokens === "number") {
    tokenUsage.inputTokens = usage.prompt_tokens;
  }
  if (typeof usage.completion_tokens === "number") {
    tokenUsage.outputTokens = usage.completion_tokens;
  }
  if (typeof usage.total_tokens === "number") {
    tokenUsage.totalTokens = usage.total_tokens;
  }
  const cached = usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens;
  if (typeof cached === "number") {
    tokenUsage.cachedInputTokens = cached;
  }
  return tokenUsage;
}

type ModelTranslation = ModelTranslationPayload["translations"][number];

/**
 * Indexes the model's translations by id, keeping the FIRST occurrence of any
 * id. The model can return the same id twice; last-write-wins silently dropped
 * the earlier (and usually intended) value.
 */
function indexTranslationsById(items: ModelTranslation[]): Map<string, string> {
  const byId = new Map<string, string>();
  for (const item of items) {
    if (!byId.has(item.id)) {
      byId.set(item.id, item.translation);
    }
  }
  return byId;
}

/**
 * Detects ids the model returned that were not requested, and ids it returned
 * more than once. Either signals an unreliable response (the matched
 * translations may be misattributed), so it is surfaced as a warning attached
 * to the batch's first result rather than being silently ignored.
 */
function responseIdAnomalyIssue(
  ownerId: string,
  requestedIds: Set<string>,
  items: ModelTranslation[]
): ValidationIssue | undefined {
  const seen = new Set<string>();
  const unexpected = new Set<string>();
  const duplicate = new Set<string>();
  for (const item of items) {
    if (!requestedIds.has(item.id)) {
      unexpected.add(item.id);
    }
    if (seen.has(item.id)) {
      duplicate.add(item.id);
    } else {
      seen.add(item.id);
    }
  }
  if (unexpected.size === 0 && duplicate.size === 0) {
    return undefined;
  }
  const parts: string[] = [];
  if (unexpected.size > 0) {
    parts.push(`unexpected ids [${[...unexpected].join(", ")}]`);
  }
  if (duplicate.size > 0) {
    parts.push(`duplicate ids [${[...duplicate].join(", ")}]`);
  }
  return {
    id: ownerId,
    severity: "warning",
    code: "PROVIDER_RESPONSE_SCHEMA_ERROR",
    message: `DeepSeek response contained ${parts.join(" and ")}`
  };
}

function withResponseIdAnomalies(
  results: TranslationResult[],
  requestedIds: Set<string>,
  payload: ModelTranslationPayload
): TranslationResult[] {
  if (results.length === 0) {
    return results;
  }
  const anomaly = responseIdAnomalyIssue(results[0].id, requestedIds, payload.translations);
  if (!anomaly) {
    return results;
  }
  const [first, ...rest] = results;
  return [{ ...first, issues: [...(first.issues ?? []), anomaly] }, ...rest];
}

export function missingApiKeyTranslationResults(
  providerName: string,
  model: string,
  batch: TranslationUnit[]
): TranslationResult[] {
  const error = new DeepSeekProviderError("Missing DEEPSEEK_API_KEY", "PROVIDER_AUTH_ERROR");
  return batch.map((unit) => failedTranslationResult(providerName, unit, model, error));
}

export function missingApiKeyReviewResults(
  providerName: string,
  model: string,
  batch: ReviewUnit[]
): TranslationResult[] {
  const error = new DeepSeekProviderError("Missing DEEPSEEK_API_KEY", "PROVIDER_AUTH_ERROR");
  return batch.map((unit) => failedReviewResult(providerName, unit, model, error));
}

export function missingApiKeyCharacterGlossary(candidates: CharacterCandidate[]): CharacterGlossary {
  return Object.fromEntries(
    candidates.map((candidate) => [
      candidate.name,
      {
        translation: candidate.suggestedTranslation ?? candidate.name,
        gender: "unknown" as const,
        type: "unknown" as const,
        description: "DeepSeek inference skipped because DEEPSEEK_API_KEY is missing.",
        confidence: 0,
        review: true
      }
    ])
  );
}

// Degraded glossary returned when character inference fails, so the provider
// reports failure as data rather than throwing (consistent with translate/review).
export function failedCharacterGlossary(candidates: CharacterCandidate[], error: unknown): CharacterGlossary {
  const message = error instanceof Error ? error.message : String(error);
  return Object.fromEntries(
    candidates.map((candidate) => [
      candidate.name,
      {
        translation: candidate.suggestedTranslation ?? candidate.name,
        gender: "unknown" as const,
        type: "unknown" as const,
        description: `Character inference failed: ${message}`,
        confidence: 0,
        review: true
      }
    ])
  );
}

export function translationResultsFromPayload(
  providerName: string,
  model: string,
  batch: TranslationUnit[],
  payload: ModelTranslationPayload,
  response: ChatCompletionResponse
): TranslationResult[] {
  const byId = indexTranslationsById(payload.translations);
  const requestedIds = new Set(batch.map((unit) => unit.id));
  const usage = response.usage;
  const tokenUsage = toTokenUsage(usage);

  const results = batch.map((unit) => {
    const translation = byId.get(unit.id);
    if (typeof translation !== "string") {
      return failedTranslationResult(
        providerName,
        unit,
        model,
        new DeepSeekProviderError(
          `DeepSeek API response is missing translation for unit '${unit.id}'`,
          "PROVIDER_RESPONSE_SCHEMA_ERROR"
        )
      );
    }

    return {
      id: unit.id,
      source: unit.source,
      translation,
      provider: providerName,
      model,
      status: "translated" as const,
      metadata: usage ? { usage, tokenUsage } : undefined
    };
  });

  return withResponseIdAnomalies(results, requestedIds, payload);
}

export function reviewResultsFromPayload(
  providerName: string,
  model: string,
  batch: ReviewUnit[],
  payload: ModelTranslationPayload,
  response: ChatCompletionResponse
): TranslationResult[] {
  const byId = indexTranslationsById(payload.translations);
  const requestedIds = new Set(batch.map((unit) => unit.id));
  const usage = response.usage;
  const tokenUsage = toTokenUsage(usage);

  const results = batch.map((unit) => {
    const translation = byId.get(unit.id);
    if (typeof translation !== "string") {
      return failedReviewResult(
        providerName,
        unit,
        model,
        new DeepSeekProviderError(
          `DeepSeek API response is missing revised translation for unit '${unit.id}'`,
          "PROVIDER_RESPONSE_SCHEMA_ERROR"
        )
      );
    }

    return {
      id: unit.id,
      source: unit.source,
      translation,
      provider: providerName,
      model,
      status: "translated" as const,
      metadata: usage ? { usage, tokenUsage, reviewed: true } : { reviewed: true }
    };
  });

  return withResponseIdAnomalies(results, requestedIds, payload);
}

export function failedTranslationResults(
  providerName: string,
  model: string,
  batch: TranslationUnit[],
  error: unknown
): TranslationResult[] {
  return batch.map((unit) => failedTranslationResult(providerName, unit, model, error));
}

export function failedReviewResults(
  providerName: string,
  model: string,
  batch: ReviewUnit[],
  error: unknown
): TranslationResult[] {
  return batch.map((unit) => failedReviewResult(providerName, unit, model, error));
}

function failedTranslationResult(
  providerName: string,
  unit: TranslationUnit,
  model: string,
  error: unknown
): TranslationResult {
  return {
    id: unit.id,
    source: unit.source,
    translation: "",
    provider: providerName,
    model,
    status: "failed",
    issues: [providerIssue(unit.id, error)]
  };
}

function failedReviewResult(
  providerName: string,
  unit: ReviewUnit,
  model: string,
  error: unknown
): TranslationResult {
  return {
    id: unit.id,
    source: unit.source,
    translation: unit.currentTranslation,
    provider: providerName,
    model,
    status: "failed",
    issues: [providerIssue(unit.id, error)],
    metadata: { reviewed: false }
  };
}
