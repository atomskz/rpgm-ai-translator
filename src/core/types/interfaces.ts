import type { CharacterCandidate, CharacterGlossary } from "./glossary.js";
import type {
  ApplyOptions,
  ApplyResult,
  CharacterInferenceOptions,
  ExtractOptions,
  ReviewOptions,
  TranslateOptions
} from "./options.js";
import type { ReviewUnit, TranslationResult, TranslationUnit } from "./translation.js";

export interface Extractor {
  extract(projectPath: string, options?: ExtractOptions): Promise<TranslationUnit[]>;
  applyTranslations(
    projectPath: string,
    translations: TranslationResult[],
    options: ApplyOptions
  ): Promise<ApplyResult>;
}

/**
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
  translateBatch(
    batch: TranslationUnit[],
    options: TranslateOptions
  ): Promise<TranslationResult[]>;
  reviewBatch(
    batch: ReviewUnit[],
    options: ReviewOptions
  ): Promise<TranslationResult[]>;
  inferCharacters(
    candidates: CharacterCandidate[],
    options: CharacterInferenceOptions
  ): Promise<CharacterGlossary>;
}
