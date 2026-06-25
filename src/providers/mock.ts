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

import type { LLMProvider } from "../core/ports/public-api.js";
import type {
  CharacterCandidate,
  CharacterGlossary,
  CharacterInferenceOptions,
  ReviewOptions,
  ReviewUnit,
  TranslateOptions,
  TranslationResult,
  TranslationUnit
} from "../core/types/public-api.js";

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
      translation:
        unit.issues && unit.issues.length > 0
          ? `[${options.targetLanguage}] ${unit.normalizedSource ?? unit.source}`
          : unit.currentTranslation,
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
