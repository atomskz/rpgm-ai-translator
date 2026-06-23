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

export type { ChatMessage } from "./prompt-builder/types.js";
export {
  buildCharacterInferenceSystemPrompt,
  buildReviewSystemPrompt,
  buildTranslationSystemPrompt
} from "./prompt-builder/system-prompts.js";
export { filterGlossaryForBatch, filterGlossaryForReviewBatch } from "./prompt-builder/glossary.js";
export { buildTranslationMessages, buildTranslationUserPayload } from "./prompt-builder/translation.js";
export { buildReviewMessages, buildReviewUserPayload } from "./prompt-builder/review.js";
export { buildCharacterInferenceMessages, buildCharacterInferenceUserPayload } from "./prompt-builder/characters.js";
