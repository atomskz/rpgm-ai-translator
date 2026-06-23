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

import type { EngineId } from "./engine.js";
import type { TokenUsage } from "./translation.js";
import type { ValidationIssue } from "./validation.js";

export type TranslationReport = {
  engine: EngineId;
  filesScanned: number;
  unitsExtracted: number;
  unitsTranslated: number;
  fromMemory: number;
  failed: number;
  issuesByCode: Record<string, number>;
  issuesByFile: Record<string, number>;
  issuesByCategory: Record<string, number>;
  validationIssues: ValidationIssue[];
  // Aggregated provider-neutral token usage across all translations. Omitted
  // when no provider reported usage (e.g. the mock provider).
  tokenUsage?: TokenUsage;
  // Non-fatal extraction/apply warnings, e.g. a data file that was skipped
  // because it could not be parsed. Omitted when there are none.
  warnings?: string[];
};
