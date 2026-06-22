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
} from "../../core/types.js";
import {
  buildCharacterInferenceMessages,
  buildReviewMessages,
  buildTranslationMessages
} from "../prompt-builder.js";
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
