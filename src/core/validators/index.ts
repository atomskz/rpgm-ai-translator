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
    issues.push(...validateUnchanged(unit, result, this.glossary));
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

// Returns the code of the first error a candidate translation introduces that was
// not already present in the previous translation (or in the supplied prior issues).
// Used by the review and repair passes to reject a change that fixes one problem
// while creating a new one, instead of shipping a freshly broken translation.
export function introducedErrorCode(
  unit: TranslationUnit,
  previous: TranslationResult | undefined,
  candidate: TranslationResult,
  validator: Validator,
  priorIssues: ValidationIssue[] = []
): ValidationIssue["code"] | undefined {
  const priorErrorCodes = new Set<ValidationIssue["code"]>();
  for (const priorIssue of priorIssues) {
    if (priorIssue.severity === "error") {
      priorErrorCodes.add(priorIssue.code);
    }
  }
  if (previous) {
    for (const previousIssue of validator.validate(unit, previous)) {
      if (previousIssue.severity === "error") {
        priorErrorCodes.add(previousIssue.code);
      }
    }
  }
  const introduced = validator
    .validate(unit, candidate)
    .find((candidateIssue) => candidateIssue.severity === "error" && !priorErrorCodes.has(candidateIssue.code));
  return introduced?.code;
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
