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

import type { Glossary, TranslationResult, TranslationUnit, ValidationIssue } from "../../types/public-api.js";
import { glossaryTermMatches } from "../../utils/text.js";
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
    if (!glossaryTermMatches(unit.source, term)) {
      continue;
    }

    switch (entry.mode) {
      case "keep":
        if (!glossaryTermMatches(result.translation, term)) {
          issues.push(issue(unit.id, "warning", "GLOSSARY_VIOLATION", `Glossary term '${term}' should be kept`));
        }
        break;
      case "custom":
        if (entry.translation && !glossaryTermMatches(result.translation, entry.translation)) {
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
