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

import type { TranslationResult, TranslationUnit, ValidationIssue } from "../../types.js";
import { restorePlaceholders } from "../../placeholders/index.js";
import { displayWidth, issue } from "./shared.js";

export function validateConstraints(unit: TranslationUnit, result: TranslationResult): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { maxLength, maxLines } = unit.constraints ?? {};
  // Measure the real text the engine would render, not the placeholder tokens.
  // A protected `<PH_1>` token is a different length from the control code it
  // stands in for, so measuring before restoring mis-counts every constrained
  // line.
  const translation = restorePlaceholders(result.translation, unit.placeholders);

  // `maxLength` is a message-box cell budget, so measure display width: a
  // full-width CJK glyph occupies two cells while `String.length` counts it as one.
  if (maxLength != null && displayWidth(translation) > maxLength) {
    issues.push(issue(unit.id, "warning", "MAX_LENGTH_EXCEEDED", `Translation exceeds maxLength ${maxLength}`));
  }

  if (maxLines != null && translation.split(/\r?\n/).length > maxLines) {
    issues.push(issue(unit.id, "error", "MAX_LINES_EXCEEDED", `Translation exceeds maxLines ${maxLines}`));
  }

  return issues;
}
