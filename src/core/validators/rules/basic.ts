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

import type { Glossary, TranslationResult, TranslationUnit, ValidationIssue } from "../../types.js";
import { containsTranslatableLetter } from "../../utils/text.js";
import { issue } from "./shared.js";

export function validateId(unit: TranslationUnit, result: TranslationResult): ValidationIssue[] {
  if (unit.id === result.id) {
    return [];
  }

  return [issue(unit.id, "error", "ID_MISMATCH", `Expected id '${unit.id}', got '${result.id}'`)];
}

export function providerIssues(result: TranslationResult): ValidationIssue[] {
  return result.issues ?? [];
}

export function validateStatus(
  unit: TranslationUnit,
  result: TranslationResult
): { issues: ValidationIssue[]; terminal: boolean } {
  if (result.status === "failed") {
    return {
      issues: [issue(unit.id, "error", "MISSING_TRANSLATION", "Translation failed")],
      terminal: true
    };
  }

  if (result.status === "skipped") {
    return {
      issues: [issue(unit.id, "info", "MISSING_TRANSLATION", "Translation was skipped")],
      terminal: true
    };
  }

  return { issues: [], terminal: false };
}

export function validateTextPresence(unit: TranslationUnit, result: TranslationResult): ValidationIssue[] {
  if (result.translation.trim().length > 0) {
    return [];
  }

  return [
    issue(unit.id, "error", "EMPTY_TRANSLATION", "Translation is empty"),
    issue(unit.id, "error", "MISSING_TRANSLATION", "Translation is missing")
  ];
}

export function validateUnchanged(
  unit: TranslationUnit,
  result: TranslationResult,
  glossary?: Glossary
): ValidationIssue[] {
  if (result.translation !== unit.source && result.translation !== unit.normalizedSource) {
    return [];
  }

  // An identical translation is expected when the whole source is a keep-mode
  // glossary term or has nothing translatable (e.g. a proper noun in symbols or
  // digits only). Flagging those produces noise and feeds the repair pass with
  // work it cannot meaningfully do.
  if (isUnchangedExpected(unit, glossary)) {
    return [];
  }

  return [issue(unit.id, "warning", "UNCHANGED_TRANSLATION", "Translation is unchanged")];
}

function isUnchangedExpected(unit: TranslationUnit, glossary?: Glossary): boolean {
  const source = unit.source.trim();
  if (source.length > 0 && !containsTranslatableLetter(source)) {
    return true;
  }
  if (!glossary) {
    return false;
  }
  const normalizedSource = unit.normalizedSource?.trim();
  return Object.entries(glossary).some(
    ([term, entry]) => entry.mode === "keep" && (term === source || term === normalizedSource)
  );
}
