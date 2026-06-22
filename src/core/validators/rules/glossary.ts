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
    if (!unit.source.includes(term)) {
      continue;
    }

    switch (entry.mode) {
      case "keep":
        if (!result.translation.includes(term)) {
          issues.push(issue(unit.id, "warning", "GLOSSARY_VIOLATION", `Glossary term '${term}' should be kept`));
        }
        break;
      case "custom":
        if (entry.translation && !result.translation.includes(entry.translation)) {
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
