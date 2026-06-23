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

import type { CharacterCandidate, CharacterInferenceOptions } from "../../core/types.js";
import { buildCharacterInferenceSystemPrompt } from "./system-prompts.js";
import type { ChatMessage } from "./types.js";

export function buildCharacterInferenceMessages(
  candidates: CharacterCandidate[],
  options: CharacterInferenceOptions
): ChatMessage[] {
  return [
    {
      role: "system",
      content: buildCharacterInferenceSystemPrompt(options.targetLanguage)
    },
    {
      role: "user",
      content: JSON.stringify(buildCharacterInferenceUserPayload(candidates, options))
    }
  ];
}

export function buildCharacterInferenceUserPayload(
  candidates: CharacterCandidate[],
  options: CharacterInferenceOptions
): Record<string, unknown> {
  return {
    targetLanguage: options.targetLanguage,
    candidates,
    expectedResponse: {
      characters: {
        "Original Name": {
          translation: "translated or transliterated name",
          gender: "male | female | neutral | unknown",
          type: "person | place | group | creature | object | unknown",
          aliases: ["optional alias"],
          description: "brief evidence-based note",
          speechStyle: "optional speech style if supported by evidence",
          confidence: 0.75,
          review: false
        }
      }
    }
  };
}
