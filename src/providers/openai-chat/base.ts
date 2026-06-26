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

import type { LLMProvider } from "../../core/ports/public-api.js";
import type {
  CharacterCandidate,
  CharacterGlossary,
  CharacterInferenceOptions,
  ReviewOptions,
  ReviewUnit,
  TranslateOptions,
  TranslationResult,
  TranslationUnit
} from "../../core/types/public-api.js";
import {
  buildCharacterInferenceMessages,
  buildReviewMessages,
  buildTranslationMessages
} from "../prompt-builder/public-api.js";
import {
  failedCharacterGlossary,
  failedReviewResults,
  failedTranslationResults,
  missingApiKeyCharacterGlossary,
  missingApiKeyReviewResults,
  missingApiKeyTranslationResults,
  reviewResultsFromPayload,
  translationResultsFromPayload
} from "./mapping.js";
import { parseCharactersPayload, parseTranslationsPayload } from "./schemas.js";
import type { ChatCompletionClient } from "./types.js";

/**
 * Shared base for any OpenAI-compatible chat-completion provider. It owns the
 * provider-neutral degradation skeleton that every adapter repeated by hand and
 * that is easy to get subtly wrong: skip an empty batch, degrade (not throw) when
 * the API key is missing, and turn a thrown request/parse error into per-unit
 * `failed` results so the client stays the single retry layer.
 *
 * A concrete provider supplies only request shaping (the {@link ChatCompletionClient})
 * and four labels — there is no per-method boilerplate to copy. Adding a provider
 * is one small subclass plus one registry entry.
 */
export abstract class OpenAiChatProvider implements LLMProvider {
  abstract readonly name: string;

  // The dialect-specific request shaping (fields sent, retries, base URL).
  protected abstract readonly client: ChatCompletionClient;

  // Model used when a request does not specify one.
  protected abstract readonly defaultModel: string;

  // Environment variable that holds the API key, named in the missing-key error.
  protected abstract readonly apiKeyName: string;

  // Human-readable endpoint label used in response/parse error messages, taken
  // from the client so a custom --base-url is named by its host, not the dialect.
  protected get host(): string {
    return this.client.host;
  }

  async translateBatch(batch: TranslationUnit[], options: TranslateOptions): Promise<TranslationResult[]> {
    const model = options.model ?? this.defaultModel;
    if (batch.length === 0) {
      return [];
    }

    if (!this.client.hasApiKey) {
      return missingApiKeyTranslationResults(this.name, model, batch, this.apiKeyName);
    }

    try {
      const response = await this.client.requestChatCompletion(
        buildTranslationMessages(batch, options),
        options,
        model,
        "translate"
      );
      return translationResultsFromPayload(
        this.name,
        model,
        batch,
        parseTranslationsPayload(response, this.host),
        response,
        this.host
      );
    } catch (error: unknown) {
      return failedTranslationResults(this.name, model, batch, error, this.host);
    }
  }

  async reviewBatch(batch: ReviewUnit[], options: ReviewOptions): Promise<TranslationResult[]> {
    const model = options.model ?? this.defaultModel;
    if (batch.length === 0) {
      return [];
    }

    if (!this.client.hasApiKey) {
      return missingApiKeyReviewResults(this.name, model, batch, this.apiKeyName);
    }

    try {
      const response = await this.client.requestChatCompletion(
        buildReviewMessages(batch, options),
        options,
        model,
        "review"
      );
      return reviewResultsFromPayload(
        this.name,
        model,
        batch,
        parseTranslationsPayload(response, this.host),
        response,
        this.host
      );
    } catch (error: unknown) {
      return failedReviewResults(this.name, model, batch, error, this.host);
    }
  }

  async inferCharacters(
    candidates: CharacterCandidate[],
    options: CharacterInferenceOptions
  ): Promise<CharacterGlossary> {
    const model = options.model ?? this.defaultModel;
    if (candidates.length === 0) {
      return {};
    }

    if (!this.client.hasApiKey) {
      return missingApiKeyCharacterGlossary(candidates, this.host, this.apiKeyName);
    }

    try {
      const response = await this.client.requestChatCompletion(
        buildCharacterInferenceMessages(candidates, options),
        options,
        model,
        "characters"
      );
      return parseCharactersPayload(response, this.host).characters;
    } catch (error: unknown) {
      // Match translate/review: report failure as a degraded glossary rather than
      // throwing, so the client stays the single retry layer and callers do not
      // retry again (which would double the backoff).
      return failedCharacterGlossary(candidates, error);
    }
  }
}
