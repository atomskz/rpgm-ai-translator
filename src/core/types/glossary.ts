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

import type { TranslationCategory, TranslationUnit } from "./translation.js";

export type GlossaryMode = "keep" | "translate" | "transliterate" | "custom";

export type Glossary = Record<
  string,
  {
    translation?: string;
    mode: GlossaryMode;
  }
>;

export type CharacterGender = "male" | "female" | "neutral" | "unknown";

export type CharacterKind = "person" | "place" | "group" | "creature" | "object" | "unknown";

export type CharacterGlossary = Record<
  string,
  {
    gender?: CharacterGender;
    type?: CharacterKind;
    translation?: string;
    aliases?: string[];
    description?: string;
    speechStyle?: string;
    confidence?: number;
    review?: boolean;
  }
>;

export type CharacterCandidate = {
  name: string;
  suggestedTranslation?: string;
  sources: Array<"actor" | "speaker" | "event" | "dialogue-mention">;
  occurrences: number;
  evidence: Array<{
    unitId: string;
    category: TranslationCategory;
    source: string;
    translation?: string;
    context?: TranslationUnit["context"];
  }>;
};
