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

import type { TranslationResult, TranslationUnit, ValidationIssue } from "../../types/public-api.js";
import { restorePlaceholders } from "../../placeholders.js";
import { extractProseNumbers, extractTechnicalTokens, extractVariables, issue, sameMultiset } from "./shared.js";

export function validateNumbers(unit: TranslationUnit, result: TranslationResult): ValidationIssue[] {
  const sourceNumbers = extractProseNumbers(unit.source);
  const translatedNumbers = extractProseNumbers(result.translation);

  if (sameMultiset(sourceNumbers, translatedNumbers)) {
    return [];
  }

  return [issue(unit.id, "error", "NUMBER_CHANGED", "Numbers differ between source and translation")];
}

export function validateVariables(unit: TranslationUnit, result: TranslationResult): ValidationIssue[] {
  const sourceVariables = extractVariables(unit.source);
  const translatedVariables = extractVariables(restorePlaceholders(result.translation, unit.placeholders));

  if (sameMultiset(sourceVariables, translatedVariables)) {
    return [];
  }

  return [issue(unit.id, "error", "VARIABLE_CHANGED", "Variables differ between source and translation")];
}

export function validateTechnicalTokens(unit: TranslationUnit, result: TranslationResult): ValidationIssue[] {
  const sourceTokens = extractTechnicalTokens(unit.source);
  const translatedTokens = extractTechnicalTokens(restorePlaceholders(result.translation, unit.placeholders));

  if (sameMultiset(sourceTokens, translatedTokens)) {
    return [];
  }

  return [issue(unit.id, "warning", "TECHNICAL_TOKEN_CHANGED", "Technical tokens differ between source and translation")];
}
