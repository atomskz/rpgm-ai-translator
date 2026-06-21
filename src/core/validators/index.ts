import type { Glossary, TranslationResult, TranslationUnit, ValidationIssue, Validator } from "../types.js";
import {
  issue,
  providerIssues,
  validateConstraints,
  validateGlossary,
  validateId,
  validateNumbers,
  validatePlaceholders,
  validateStatus,
  validateTechnicalTokens,
  validateTextPresence,
  validateUnchanged,
  validateVariables
} from "./rules/index.js";

export class DefaultValidator implements Validator {
  constructor(private readonly glossary?: Glossary) {}

  validate(unit: TranslationUnit, result: TranslationResult): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    issues.push(...validateId(unit, result));
    issues.push(...providerIssues(result));

    const status = validateStatus(unit, result);
    issues.push(...status.issues);
    if (status.terminal) {
      return issues;
    }

    issues.push(...validateTextPresence(unit, result));
    issues.push(...validateUnchanged(unit, result));
    issues.push(...validatePlaceholders(unit, result));
    issues.push(...validateNumbers(unit, result));
    issues.push(...validateVariables(unit, result));
    issues.push(...validateTechnicalTokens(unit, result));
    issues.push(...validateConstraints(unit, result));
    issues.push(...validateGlossary(unit, result, this.glossary));

    return issues;
  }
}

export function validateTranslationResults(
  units: TranslationUnit[],
  results: TranslationResult[],
  validator: Validator = new DefaultValidator()
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  const resultsById = new Map<string, TranslationResult>();

  for (const result of results) {
    const unit = unitsById.get(result.id);
    if (!unit) {
      issues.push(issue(result.id, "error", "UNKNOWN_TRANSLATION_ID", `Unknown translation id '${result.id}'`));
      continue;
    }
    resultsById.set(result.id, result);
    issues.push(...validator.validate(unit, result));
  }

  for (const unit of units) {
    if (!resultsById.has(unit.id)) {
      issues.push(issue(unit.id, "error", "MISSING_TRANSLATION", `Missing translation for '${unit.id}'`));
    }
  }

  return issues;
}

export function filterTranslationsWithoutValidationErrors(
  translations: TranslationResult[],
  validationIssues: ValidationIssue[]
): TranslationResult[] {
  const invalidIds = new Set(
    validationIssues.filter((validationIssue) => validationIssue.severity === "error" && validationIssue.id).map((validationIssue) => validationIssue.id)
  );

  return translations.filter((translation) => !invalidIds.has(translation.id));
}
