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

import type { TranslationCategory, TranslationUnit } from "../types/public-api.js";

export type MemoryEntry = {
  source: string;
  sourceHash: string;
  /**
   * Composite lookup key. Unlike `sourceHash` it also folds in the target
   * language, glossary, constraints and context so that the same source string
   * is not reused across languages or incompatible layout constraints. Optional
   * for backward compatibility with memory files written before this field
   * existed; such entries fall back to `sourceHash` and therefore simply miss.
   */
  cacheKey?: string;
  targetLanguage?: string;
  translation: string;
  category: TranslationCategory;
  context?: TranslationUnit["context"];
  provider: string;
  model: string;
  status: "translated" | "failed" | "skipped";
  createdAt: string;
  updatedAt: string;
};

export interface TranslationMemory {
  get(sourceHash: string): Promise<MemoryEntry | undefined>;
  upsert(entry: MemoryEntry): Promise<void>;
  upsertMany?(entries: MemoryEntry[]): Promise<void>;
}
