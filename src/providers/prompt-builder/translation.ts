import type { TranslateOptions, TranslationUnit } from "../../core/types.js";
import { filterGlossaryForBatch } from "./glossary.js";
import { buildTranslationSystemPrompt } from "./system-prompts.js";
import type { ChatMessage } from "./types.js";

export function buildTranslationMessages(batch: TranslationUnit[], options: TranslateOptions): ChatMessage[] {
  return [
    {
      role: "system",
      content: buildTranslationSystemPrompt(options.targetLanguage)
    },
    {
      role: "user",
      content: JSON.stringify(buildTranslationUserPayload(batch, options))
    }
  ];
}

export function buildTranslationUserPayload(batch: TranslationUnit[], options: TranslateOptions): Record<string, unknown> {
  return {
    targetLanguage: options.targetLanguage,
    glossary: filterGlossaryForBatch(options.glossary, batch),
    units: batch.map((unit) => ({
      id: unit.id,
      source: unit.source,
      text: unit.normalizedSource ?? unit.source,
      category: unit.category,
      context: unit.context ?? {},
      constraints: unit.constraints ?? {},
      placeholders: unit.placeholders ?? []
    })),
    expectedResponse: {
      translations: [
        {
          id: "same id as input unit",
          translation: "translated text with placeholders preserved"
        }
      ]
    }
  };
}
