import type {
  CharacterCandidate,
  CharacterGlossary,
  ReviewUnit,
  TranslationResult,
  TranslationUnit
} from "../../core/types.js";
import { DeepSeekProviderError, providerIssue } from "./errors.js";
import type { ChatCompletionResponse, ModelTranslationPayload } from "./types.js";

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

export function translationResultsFromPayload(
  providerName: string,
  model: string,
  batch: TranslationUnit[],
  payload: ModelTranslationPayload,
  response: ChatCompletionResponse
): TranslationResult[] {
  const byId = new Map(payload.translations.map((item) => [item.id, item.translation]));
  const usage = response.usage;

  return batch.map((unit) => {
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
      status: "translated",
      metadata: usage ? { usage } : undefined
    };
  });
}

export function reviewResultsFromPayload(
  providerName: string,
  model: string,
  batch: ReviewUnit[],
  payload: ModelTranslationPayload,
  response: ChatCompletionResponse
): TranslationResult[] {
  const byId = new Map(payload.translations.map((item) => [item.id, item.translation]));
  const usage = response.usage;

  return batch.map((unit) => {
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
      status: "translated",
      metadata: usage ? { usage, reviewed: true } : { reviewed: true }
    };
  });
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
