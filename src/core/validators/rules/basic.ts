import type { TranslationResult, TranslationUnit, ValidationIssue } from "../../types.js";
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

export function validateUnchanged(unit: TranslationUnit, result: TranslationResult): ValidationIssue[] {
  if (result.translation !== unit.source && result.translation !== unit.normalizedSource) {
    return [];
  }

  return [issue(unit.id, "warning", "UNCHANGED_TRANSLATION", "Translation is unchanged")];
}
