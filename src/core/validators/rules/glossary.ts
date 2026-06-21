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

    if (entry.mode === "keep" && !result.translation.includes(term)) {
      issues.push(issue(unit.id, "warning", "GLOSSARY_VIOLATION", `Glossary term '${term}' should be kept`));
    }

    if (entry.mode === "custom" && entry.translation && !result.translation.includes(entry.translation)) {
      issues.push(
        issue(unit.id, "warning", "GLOSSARY_VIOLATION", `Glossary term '${term}' should use '${entry.translation}'`)
      );
    }
  }

  return issues;
}
