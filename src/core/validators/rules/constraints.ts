import type { TranslationResult, TranslationUnit, ValidationIssue } from "../../types.js";
import { issue } from "./shared.js";

export function validateConstraints(unit: TranslationUnit, result: TranslationResult): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { maxLength, maxLines } = unit.constraints ?? {};

  if (maxLength != null && result.translation.length > maxLength) {
    issues.push(issue(unit.id, "warning", "MAX_LENGTH_EXCEEDED", `Translation exceeds maxLength ${maxLength}`));
  }

  if (maxLines != null && result.translation.split(/\r?\n/).length > maxLines) {
    issues.push(issue(unit.id, "warning", "MAX_LINES_EXCEEDED", `Translation exceeds maxLines ${maxLines}`));
  }

  return issues;
}
