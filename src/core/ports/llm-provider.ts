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

import type { CharacterCandidate, CharacterGlossary } from "../types/glossary.js";
import type { CharacterInferenceOptions, ReviewOptions, TranslateOptions } from "../types/options.js";
import type { ReviewUnit, TranslationResult, TranslationUnit } from "../types/translation.js";

/**
 * Port implemented by an LLM provider adapter (DeepSeek, mock, ...).
 *
 * Retry contract: a provider owns retrying its own transient failures (e.g. its
 * HTTP client retries timeouts, rate limits and 5xx, honoring `retryAttempts`)
 * and MUST NOT retry authentication or billing errors. On failure it returns
 * `status: "failed"` results (or, for `inferCharacters`, a degraded glossary)
 * instead of throwing. The pipeline's `withProviderRetry` is only a safety net
 * for a provider that throws anyway; with a well-behaved provider it never
 * double-retries.
 */
export interface LLMProvider {
  readonly name: string;
  translateBatch(batch: TranslationUnit[], options: TranslateOptions): Promise<TranslationResult[]>;
  reviewBatch(batch: ReviewUnit[], options: ReviewOptions): Promise<TranslationResult[]>;
  inferCharacters(candidates: CharacterCandidate[], options: CharacterInferenceOptions): Promise<CharacterGlossary>;
}
