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
import { countToken, restorePlaceholders } from "../../placeholders.js";
import { issue } from "./shared.js";

export function validatePlaceholders(unit: TranslationUnit, result: TranslationResult): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const placeholders = unit.placeholders ?? [];
  const expectedTokens = new Set(placeholders.map((placeholder) => placeholder.token));
  const rawCounts = new Map<string, number>();
  const missingTokenPlaceholders: typeof placeholders = [];

  for (const placeholder of placeholders) {
    const tokenCount = countToken(result.translation, placeholder.token);
    if (tokenCount === 0) {
      missingTokenPlaceholders.push(placeholder);
    }
    if (tokenCount > 1) {
      issues.push(issue(unit.id, "error", "DUPLICATE_PLACEHOLDER", `Duplicate placeholder ${placeholder.token}`));
    }
  }

  for (const placeholder of missingTokenPlaceholders) {
    rawCounts.set(placeholder.value, countToken(result.translation, placeholder.value));
  }

  const consumedRawCounts = new Map<string, number>();
  for (const placeholder of missingTokenPlaceholders) {
    const consumed = consumedRawCounts.get(placeholder.value) ?? 0;
    const available = rawCounts.get(placeholder.value) ?? 0;
    if (available <= consumed && placeholder.required) {
      issues.push(issue(unit.id, "error", "MISSING_PLACEHOLDER", `Missing placeholder ${placeholder.token}`));
      continue;
    }
    consumedRawCounts.set(placeholder.value, consumed + 1);
  }

  for (const [rawValue, available] of rawCounts.entries()) {
    const consumed = consumedRawCounts.get(rawValue) ?? 0;
    if (available > consumed) {
      issues.push(issue(unit.id, "error", "DUPLICATE_PLACEHOLDER", `Duplicate raw placeholder value ${rawValue}`));
    }
  }

  for (const token of result.translation.match(/<PH_\d+>/g) ?? []) {
    if (!expectedTokens.has(token)) {
      issues.push(issue(unit.id, "error", "EXTRA_PLACEHOLDER", `Unexpected placeholder ${token}`));
    }
  }

  const restored = restorePlaceholders(result.translation, placeholders);
  for (const placeholder of placeholders.filter((item) => item.kind === "control-code")) {
    if (!restored.includes(placeholder.value)) {
      issues.push(issue(unit.id, "error", "CONTROL_CODE_CHANGED", `Control code changed: ${placeholder.value}`));
    }
  }

  return issues;
}
