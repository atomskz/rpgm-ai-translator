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

import type { TranslationResult, TranslationUnit, ValidationIssue } from "../../types/types.js";
import { visibleText } from "../../placeholders.js";
import { displayWidth, issue } from "./shared.js";

export function validateConstraints(unit: TranslationUnit, result: TranslationResult): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { maxLength, maxLines } = unit.constraints ?? {};
  // Measure the glyphs the engine would actually draw, not the placeholder
  // tokens nor the control codes they stand for. Control codes (`\C[n]`, `\I[n]`,
  // ...) are directives that render nothing, so counting their literal characters
  // inflated the width of every line containing one and produced spurious
  // MAX_LENGTH_EXCEEDED warnings (which then fed wasted repair work).
  const rendered = visibleText(result.translation, unit.placeholders);

  // `maxLength` is a per-line message-box cell budget, so measure the widest
  // rendered line, not the whole string: a translation legitimately wrapped across
  // lines must not be summed into a false overflow. Display width (not
  // `String.length`) is used because a full-width CJK glyph occupies two cells.
  if (maxLength != null) {
    const widestLine = Math.max(...rendered.split(/\r?\n/).map((line) => displayWidth(line)));
    if (widestLine > maxLength) {
      issues.push(issue(unit.id, "warning", "MAX_LENGTH_EXCEEDED", `Translation exceeds maxLength ${maxLength}`));
    }
  }

  if (maxLines != null && rendered.split(/\r?\n/).length > maxLines) {
    issues.push(issue(unit.id, "error", "MAX_LINES_EXCEEDED", `Translation exceeds maxLines ${maxLines}`));
  }

  return issues;
}
