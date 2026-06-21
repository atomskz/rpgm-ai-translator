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
