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

import type { CharacterCandidate, CharacterInferenceOptions } from "../../core/types/types.js";
import { buildCharacterInferenceSystemPrompt } from "./system-prompts.js";
import type { ChatMessage } from "./types.js";

// Bound the evidence sent per candidate so a character with hundreds of long lines
// cannot inflate the prompt past the context window (which would only surface as a
// wasted, truncated response). A handful of representative snippets is enough for
// name inference.
const MAX_EVIDENCE_PER_CANDIDATE = 12;
const MAX_EVIDENCE_SNIPPET_CHARS = 200;

function truncateSnippet(text: string): string {
  return text.length > MAX_EVIDENCE_SNIPPET_CHARS ? `${text.slice(0, MAX_EVIDENCE_SNIPPET_CHARS)}…` : text;
}

function boundCandidateEvidence(candidate: CharacterCandidate): CharacterCandidate {
  return {
    ...candidate,
    evidence: candidate.evidence.slice(0, MAX_EVIDENCE_PER_CANDIDATE).map((item) => ({
      ...item,
      source: truncateSnippet(item.source),
      translation: item.translation == null ? item.translation : truncateSnippet(item.translation)
    }))
  };
}

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
    candidates: candidates.map(boundCandidateEvidence),
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
