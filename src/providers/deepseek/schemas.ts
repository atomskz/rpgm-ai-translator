import type { CharacterGlossary, ProviderUsage } from "../../core/types.js";
import { DeepSeekProviderError } from "./errors.js";
import type { ChatCompletionResponse, ModelCharactersPayload, ModelTranslationPayload } from "./types.js";

export function parseModelPayload(response: ChatCompletionResponse): ModelTranslationPayload {
  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new DeepSeekProviderError(
      "DeepSeek API response did not include message content",
      "PROVIDER_RESPONSE_SCHEMA_ERROR"
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error: unknown) {
    throw new DeepSeekProviderError(
      `DeepSeek API returned invalid JSON content: ${error instanceof Error ? error.message : String(error)}`,
      "PROVIDER_RESPONSE_ERROR",
      { cause: error }
    );
  }

  if (!isModelTranslationPayload(parsed)) {
    throw new DeepSeekProviderError(
      "DeepSeek API JSON content did not match expected translations schema",
      "PROVIDER_RESPONSE_SCHEMA_ERROR"
    );
  }

  return parsed;
}

export function parseCharactersPayload(response: ChatCompletionResponse): ModelCharactersPayload {
  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new DeepSeekProviderError(
      "DeepSeek API response did not include message content",
      "PROVIDER_RESPONSE_SCHEMA_ERROR"
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error: unknown) {
    throw new DeepSeekProviderError(
      `DeepSeek API returned invalid JSON content: ${error instanceof Error ? error.message : String(error)}`,
      "PROVIDER_RESPONSE_ERROR",
      { cause: error }
    );
  }

  if (!isModelCharactersPayload(parsed)) {
    throw new DeepSeekProviderError(
      "DeepSeek API JSON content did not match expected characters schema",
      "PROVIDER_RESPONSE_SCHEMA_ERROR"
    );
  }

  return parsed;
}

export function isChatCompletionResponse(value: unknown): value is ChatCompletionResponse {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<ChatCompletionResponse>;
  return Array.isArray(candidate.choices) && (candidate.usage == null || isProviderUsage(candidate.usage));
}

function isProviderUsage(value: unknown): value is ProviderUsage {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<ProviderUsage>;
  return (
    optionalNumber(candidate.prompt_tokens) &&
    optionalNumber(candidate.completion_tokens) &&
    optionalNumber(candidate.total_tokens) &&
    optionalUsageDetails(candidate.prompt_tokens_details) &&
    optionalUsageDetails(candidate.completion_tokens_details) &&
    optionalNumber(candidate.prompt_cache_hit_tokens) &&
    optionalNumber(candidate.prompt_cache_miss_tokens)
  );
}

function optionalUsageDetails(value: unknown): boolean {
  if (value == null) {
    return true;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as { cached_tokens?: unknown };
  return optionalNumber(candidate.cached_tokens);
}

function optionalNumber(value: unknown): boolean {
  return value == null || typeof value === "number";
}

function isModelTranslationPayload(value: unknown): value is ModelTranslationPayload {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<ModelTranslationPayload>;
  return (
    Array.isArray(candidate.translations) &&
    candidate.translations.every(
      (item) =>
        typeof item === "object" &&
        item != null &&
        !Array.isArray(item) &&
        typeof (item as { id?: unknown }).id === "string" &&
        typeof (item as { translation?: unknown }).translation === "string"
    )
  );
}

function isModelCharactersPayload(value: unknown): value is ModelCharactersPayload {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return false;
  }
  const characters = (value as { characters?: unknown }).characters;
  if (typeof characters !== "object" || characters == null || Array.isArray(characters)) {
    return false;
  }

  return Object.values(characters as CharacterGlossary).every((entry) => {
    if (typeof entry !== "object" || entry == null || Array.isArray(entry)) {
      return false;
    }
    const candidate = entry as {
      gender?: unknown;
      type?: unknown;
      translation?: unknown;
      aliases?: unknown;
      description?: unknown;
      speechStyle?: unknown;
      confidence?: unknown;
      review?: unknown;
    };
    return (
      (candidate.gender == null || ["male", "female", "neutral", "unknown"].includes(String(candidate.gender))) &&
      (candidate.type == null || ["person", "place", "group", "creature", "object", "unknown"].includes(String(candidate.type))) &&
      (candidate.translation == null || typeof candidate.translation === "string") &&
      (candidate.description == null || typeof candidate.description === "string") &&
      (candidate.speechStyle == null || typeof candidate.speechStyle === "string") &&
      (candidate.confidence == null || typeof candidate.confidence === "number") &&
      (candidate.review == null || typeof candidate.review === "boolean") &&
      (candidate.aliases == null || (Array.isArray(candidate.aliases) && candidate.aliases.every((alias) => typeof alias === "string")))
    );
  });
}
