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

// Version of the prompt wording (system prompts + payload shape) that produces a
// translation. It is folded into the resumable run signature and the translation
// memory key, so editing the prompts and bumping this number discards stale
// checkpoints and is a memory miss — a later prompt change can no longer silently
// reuse output produced under the old wording. Bump it whenever the prompt
// instructions or the request payload shape change in a way that affects output.
//
// History: 1 = pre-Phase-2 prompts; 2 = length-constraint, character-glossary and
// validation-issue instructions added to the translate/review/repair prompts.
export const PROMPT_VERSION = 2;
