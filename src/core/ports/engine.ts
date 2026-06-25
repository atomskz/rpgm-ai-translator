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

import type {
  ApplyOptions,
  ApplyResult,
  DetectedEngine,
  ExtractOptions,
  TranslationResult,
  TranslationUnit
} from "../types/public-api.js";

/** Port implemented by an engine adapter to detect a supported game project. */
export interface EngineDetector {
  detect(projectPath: string): Promise<DetectedEngine>;
}

/** Port implemented by an engine adapter to extract translatable units and write them back. */
export interface Extractor {
  extract(projectPath: string, options?: ExtractOptions): Promise<TranslationUnit[]>;
  applyTranslations(
    projectPath: string,
    translations: TranslationResult[],
    options: ApplyOptions
  ): Promise<ApplyResult>;
}
