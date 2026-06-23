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
import { issue } from "./shared.js";

export function validateGlossary(
  unit: TranslationUnit,
  result: TranslationResult,
  glossary?: Glossary
): ValidationIssue[] {
  if (!glossary) {
    return [];
  }

  const issues: ValidationIssue[] = [];
  for (const [term, entry] of Object.entries(glossary)) {
    if (!termMatches(unit.source, term)) {
      continue;
    }

    switch (entry.mode) {
      case "keep":
        if (!termMatches(result.translation, term)) {
          issues.push(issue(unit.id, "warning", "GLOSSARY_VIOLATION", `Glossary term '${term}' should be kept`));
        }
        break;
      case "custom":
        if (entry.translation && !termMatches(result.translation, entry.translation)) {
          issues.push(
            issue(unit.id, "warning", "GLOSSARY_VIOLATION", `Glossary term '${term}' should use '${entry.translation}'`)
          );
        }
        break;
      case "translate":
      case "transliterate":
        // Advisory only: these modes are communicated to the model through the
        // system prompt. Their phonetic/meaning result cannot be checked
        // mechanically here without risking false positives, so no issue is raised.
        break;
    }
  }

  return issues;
}

// CJK scripts (kana, ideographs, hangul) are written without word delimiters, so
// substring matching is correct for them. Alphabetic terms (Latin, Cyrillic, ...)
// must match on word boundaries, otherwise a short term such as "Ko" matches
// inside "Kobold" and produces false glossary violations.
const CJK_PATTERN = /[぀-ヿ㐀-鿿가-힯豈-﫿]/;

function termMatches(text: string, term: string): boolean {
  if (term.length === 0) {
    return false;
  }
  if (CJK_PATTERN.test(term)) {
    return text.includes(term);
  }
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(term)}(?![\\p{L}\\p{N}_])`, "u");
  return pattern.test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
