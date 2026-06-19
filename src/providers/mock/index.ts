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

export class MockProvider implements LLMProvider {
  readonly name = "mock";

  async translateBatch(batch: TranslationUnit[], options: TranslateOptions): Promise<TranslationResult[]> {
    return batch.map((unit) => ({
      id: unit.id,
      source: unit.source,
      translation: `[${options.targetLanguage}] ${unit.normalizedSource ?? unit.source}`,
      provider: this.name,
      model: options.model ?? "mock-echo",
      status: "translated"
    }));
  }

  async reviewBatch(batch: ReviewUnit[], options: ReviewOptions): Promise<TranslationResult[]> {
    return batch.map((unit) => ({
      id: unit.id,
      source: unit.source,
      translation: unit.currentTranslation,
      provider: this.name,
      model: options.model ?? "mock-review",
      status: "translated",
      metadata: { reviewed: true }
    }));
  }

  async inferCharacters(
    candidates: CharacterCandidate[],
    _options: CharacterInferenceOptions
  ): Promise<CharacterGlossary> {
    return Object.fromEntries(
      candidates.map((candidate) => [
        candidate.name,
        {
          translation: candidate.suggestedTranslation ?? candidate.name,
          gender: "unknown" as const,
          type: candidate.sources.includes("actor") || candidate.sources.includes("speaker") ? ("person" as const) : ("unknown" as const),
          aliases: [],
          description: `Mock character candidate from ${candidate.sources.join(", ")}.`,
          confidence: candidate.sources.includes("actor") || candidate.sources.includes("speaker") ? 0.5 : 0.25,
          review: true
        }
      ])
    );
  }
}
