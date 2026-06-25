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

import type { Glossary, ReviewOptions, ReviewUnit } from "../../core/types/public-api.js";
import { filterGlossaryForReviewBatch } from "./glossary.js";
import { buildReviewSystemPrompt } from "./system-prompts.js";
import type { ChatMessage } from "./types.js";

export function buildReviewMessages(batch: ReviewUnit[], options: ReviewOptions): ChatMessage[] {
  const glossary = filterGlossaryForReviewBatch(options.glossary, batch, options.onWarning);
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

// `glossary` is the already-filtered glossary for this batch. buildReviewMessages
// is the single entry point that filters once and passes it in; this builder no
// longer recomputes the filter by default.
export function buildReviewUserPayload(
  batch: ReviewUnit[],
  options: ReviewOptions,
  glossary: Glossary
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
