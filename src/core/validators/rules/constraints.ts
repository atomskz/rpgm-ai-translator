import type { TranslationResult, TranslationUnit, ValidationIssue } from "../../types.js";
import { restorePlaceholders } from "../../placeholders/index.js";
import { issue } from "./shared.js";

export function validateConstraints(unit: TranslationUnit, result: TranslationResult): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { maxLength, maxLines } = unit.constraints ?? {};
  // Measure the real text the engine would render, not the placeholder tokens.
  // A protected `<PH_1>` token is a different length from the control code it
  // stands in for, so measuring before restoring mis-counts every constrained
  // line.
  const translation = restorePlaceholders(result.translation, unit.placeholders);

  if (maxLength != null && translation.length > maxLength) {
    issues.push(issue(unit.id, "warning", "MAX_LENGTH_EXCEEDED", `Translation exceeds maxLength ${maxLength}`));
  }

  if (maxLines != null && translation.split(/\r?\n/).length > maxLines) {
    issues.push(issue(unit.id, "error", "MAX_LINES_EXCEEDED", `Translation exceeds maxLines ${maxLines}`));
  }

  return issues;
}
