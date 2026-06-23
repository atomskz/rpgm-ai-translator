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

import type { TranslateOptions, TranslationUnit } from "../../core/types.js";
import { filterGlossaryForBatch } from "./glossary.js";
import { buildTranslationSystemPrompt } from "./system-prompts.js";
import type { ChatMessage } from "./types.js";

export function buildTranslationMessages(batch: TranslationUnit[], options: TranslateOptions): ChatMessage[] {
  const glossary = filterGlossaryForBatch(options.glossary, batch);
  return [
    {
      role: "system",
      content: buildTranslationSystemPrompt(options.targetLanguage, Object.keys(glossary).length > 0)
    },
    {
      role: "user",
      content: JSON.stringify(buildTranslationUserPayload(batch, options, glossary))
    }
  ];
}

export function buildTranslationUserPayload(
  batch: TranslationUnit[],
  options: TranslateOptions,
  glossary = filterGlossaryForBatch(options.glossary, batch)
): Record<string, unknown> {
  return {
    targetLanguage: options.targetLanguage,
    glossary,
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
