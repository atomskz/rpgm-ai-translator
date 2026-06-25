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

import type { CharacterGlossary, ProviderUsage } from "../../core/types/types.js";
import { DeepSeekProviderError } from "./errors.js";
import type { ChatCompletionResponse, ModelCharactersPayload, ModelTranslationPayload } from "./types.js";

export function parseModelPayload(response: ChatCompletionResponse): ModelTranslationPayload {
  const parsed = parseJsonContent(response);

  if (!isModelTranslationPayload(parsed)) {
    throw new DeepSeekProviderError(
      "DeepSeek API JSON content did not match expected translations schema",
      "PROVIDER_RESPONSE_SCHEMA_ERROR"
    );
  }

  return parsed;
}

export function parseCharactersPayload(response: ChatCompletionResponse): ModelCharactersPayload {
  const parsed = parseJsonContent(response);

  if (!isModelCharactersPayload(parsed)) {
    throw new DeepSeekProviderError(
      "DeepSeek API JSON content did not match expected characters schema",
      "PROVIDER_RESPONSE_SCHEMA_ERROR"
    );
  }

  return parsed;
}

// Extracts and parses the JSON content of a chat completion, distinguishing a
// response truncated at max_tokens (finish_reason "length") from a genuinely
// empty or malformed one. Truncation is the common failure for reasoning models
// whose chain-of-thought consumes the whole max_tokens budget, so it gets an
// actionable message instead of a generic "no content" / "invalid JSON".
function parseJsonContent(response: ChatCompletionResponse): unknown {
  const choice = response.choices[0];
  const content = choice?.message?.content;
  const truncated = choice?.finish_reason === "length";

  if (!content) {
    if (truncated) {
      throw new DeepSeekProviderError(
        "DeepSeek response was truncated at the max_tokens limit before any content was produced; increase --max-tokens (a reasoning model spends max_tokens on its chain-of-thought).",
        "PROVIDER_RESPONSE_ERROR"
      );
    }
    throw new DeepSeekProviderError(
      "DeepSeek API response did not include message content",
      "PROVIDER_RESPONSE_SCHEMA_ERROR"
    );
  }

  try {
    return JSON.parse(content);
  } catch (error: unknown) {
    if (truncated) {
      throw new DeepSeekProviderError(
        "DeepSeek response was truncated at the max_tokens limit (incomplete JSON); increase --max-tokens (a reasoning model spends max_tokens on its chain-of-thought).",
        "PROVIDER_RESPONSE_ERROR",
        { cause: error }
      );
    }
    throw new DeepSeekProviderError(
      `DeepSeek API returned invalid JSON content: ${error instanceof Error ? error.message : String(error)}`,
      "PROVIDER_RESPONSE_ERROR",
      { cause: error }
    );
  }
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
