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
