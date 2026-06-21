import type { TranslationResult, TranslationUnit, ValidationIssue } from "../../types.js";
import { restorePlaceholders } from "../../placeholders/index.js";
import { extractNumbers, extractTechnicalTokens, extractVariables, issue, sameMultiset } from "./shared.js";

export function validateNumbers(unit: TranslationUnit, result: TranslationResult): ValidationIssue[] {
  const sourceNumbers = extractNumbers(unit.source);
  const translatedNumbers = extractNumbers(restorePlaceholders(result.translation, unit.placeholders));

  if (sameMultiset(sourceNumbers, translatedNumbers)) {
    return [];
  }

  return [issue(unit.id, "warning", "NUMBER_CHANGED", "Numbers differ between source and translation")];
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
