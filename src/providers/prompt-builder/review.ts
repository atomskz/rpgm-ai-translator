import type { ReviewOptions, ReviewUnit } from "../../core/types.js";
import { filterGlossaryForReviewBatch } from "./glossary.js";
import { buildReviewSystemPrompt } from "./system-prompts.js";
import type { ChatMessage } from "./types.js";

export function buildReviewMessages(batch: ReviewUnit[], options: ReviewOptions): ChatMessage[] {
  const glossary = filterGlossaryForReviewBatch(options.glossary, batch);
  return [
    {
      role: "system",
      content: buildReviewSystemPrompt(options.targetLanguage, Object.keys(glossary).length > 0)
    },
    {
      role: "user",
      content: JSON.stringify(buildReviewUserPayload(batch, options, glossary))
    }
  ];
}

export function buildReviewUserPayload(
  batch: ReviewUnit[],
  options: ReviewOptions,
  glossary = filterGlossaryForReviewBatch(options.glossary, batch)
): Record<string, unknown> {
  return {
    targetLanguage: options.targetLanguage,
    glossary,
    characters: options.characterGlossary ?? {},
    units: batch.map((unit) => ({
      id: unit.id,
      source: unit.source,
      text: unit.normalizedSource ?? unit.source,
      currentTranslation: unit.currentTranslation,
      category: unit.category,
      context: unit.context ?? {},
      constraints: unit.constraints ?? {},
      placeholders: unit.placeholders ?? [],
      validationIssues: unit.issues ?? []
    })),
    expectedResponse: {
      translations: [
        {
          id: "same id as input unit",
          translation: "revised translation with placeholders preserved"
        }
      ]
    }
  };
}
