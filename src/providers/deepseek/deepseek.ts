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
  CharacterCandidate,
  CharacterGlossary,
  CharacterInferenceOptions,
  ReviewOptions,
  ReviewUnit,
  TranslateOptions,
  TranslationResult,
  TranslationUnit
} from "../../core/types/types.js";
import {
  buildCharacterInferenceMessages,
  buildReviewMessages,
  buildTranslationMessages
} from "../prompt-builder/prompt-builder.js";
import { DeepSeekClient } from "./client.js";
import { DEFAULT_MODEL } from "./defaults.js";
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
import { parseCharactersPayload, parseModelPayload } from "./schemas.js";
import type { DeepSeekProviderConfig } from "./types.js";

export class DeepSeekProvider implements LLMProvider {
  readonly name = "deepseek";

  private readonly client: DeepSeekClient;

  constructor(config: DeepSeekProviderConfig = {}) {
    this.client = new DeepSeekClient(config);
  }

  async translateBatch(batch: TranslationUnit[], options: TranslateOptions): Promise<TranslationResult[]> {
    const model = options.model ?? DEFAULT_MODEL;
    if (batch.length === 0) {
      return [];
    }

    if (!this.client.hasApiKey) {
      return missingApiKeyTranslationResults(this.name, model, batch);
    }

    try {
      const response = await this.client.requestChatCompletion(
        buildTranslationMessages(batch, options),
        options,
        model,
        "disabled"
      );
      return translationResultsFromPayload(this.name, model, batch, parseModelPayload(response), response);
    } catch (error: unknown) {
      return failedTranslationResults(this.name, model, batch, error);
    }
  }

  async reviewBatch(batch: ReviewUnit[], options: ReviewOptions): Promise<TranslationResult[]> {
    const model = options.model ?? DEFAULT_MODEL;
    if (batch.length === 0) {
      return [];
    }

    if (!this.client.hasApiKey) {
      return missingApiKeyReviewResults(this.name, model, batch);
    }

    try {
      const response = await this.client.requestChatCompletion(
        buildReviewMessages(batch, options),
        options,
        model,
        "enabled"
      );
      return reviewResultsFromPayload(this.name, model, batch, parseModelPayload(response), response);
    } catch (error: unknown) {
      return failedReviewResults(this.name, model, batch, error);
    }
  }

  async inferCharacters(
    candidates: CharacterCandidate[],
    options: CharacterInferenceOptions
  ): Promise<CharacterGlossary> {
    const model = options.model ?? DEFAULT_MODEL;
    if (candidates.length === 0) {
      return {};
    }

    if (!this.client.hasApiKey) {
      return missingApiKeyCharacterGlossary(candidates);
    }

    try {
      const response = await this.client.requestChatCompletion(
        buildCharacterInferenceMessages(candidates, options),
        options,
        model,
        "disabled"
      );
      return parseCharactersPayload(response).characters;
    } catch (error: unknown) {
      // Match translate/review: report failure as a degraded glossary rather than
      // throwing, so the client stays the single retry layer and callers do not
      // retry again (which would double the backoff).
      return failedCharacterGlossary(candidates, error);
    }
  }
}

export type { DeepSeekProviderConfig } from "./types.js";
