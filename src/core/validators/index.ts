import type { Glossary, TranslationResult, TranslationUnit, ValidationIssue, Validator } from "../types.js";
import { countToken, restorePlaceholders } from "../placeholders/index.js";

export class DefaultValidator implements Validator {
  constructor(private readonly glossary?: Glossary) {}

  validate(unit: TranslationUnit, result: TranslationResult): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (unit.id !== result.id) {
      issues.push(issue(unit.id, "error", "ID_MISMATCH", `Expected id '${unit.id}', got '${result.id}'`));
    }

    if (result.issues) {
      issues.push(...result.issues);
    }

    if (result.status === "failed") {
      issues.push(issue(unit.id, "error", "MISSING_TRANSLATION", "Translation failed"));
      return issues;
    }

    if (result.status === "skipped") {
      issues.push(issue(unit.id, "info", "MISSING_TRANSLATION", "Translation was skipped"));
      return issues;
    }

    if (result.translation.trim().length === 0) {
      issues.push(issue(unit.id, "error", "EMPTY_TRANSLATION", "Translation is empty"));
      issues.push(issue(unit.id, "error", "MISSING_TRANSLATION", "Translation is missing"));
    }

    if (result.translation === unit.source || result.translation === unit.normalizedSource) {
      issues.push(issue(unit.id, "warning", "UNCHANGED_TRANSLATION", "Translation is unchanged"));
    }

    validatePlaceholders(unit, result, issues);
    validateNumbers(unit, result, issues);
    validateVariables(unit, result, issues);
    validateTechnicalTokens(unit, result, issues);
    validateConstraints(unit, result, issues);
    validateGlossary(unit, result, issues, this.glossary);

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

function validatePlaceholders(
  unit: TranslationUnit,
  result: TranslationResult,
  issues: ValidationIssue[]
): void {
  const placeholders = unit.placeholders ?? [];
  const expectedTokens = new Set(placeholders.map((placeholder) => placeholder.token));
  const rawCounts = new Map<string, number>();
  const missingTokenPlaceholders: typeof placeholders = [];

  for (const placeholder of placeholders) {
    const tokenCount = countToken(result.translation, placeholder.token);
    if (tokenCount === 0) {
      missingTokenPlaceholders.push(placeholder);
    }
    if (tokenCount > 1) {
      issues.push(issue(unit.id, "error", "DUPLICATE_PLACEHOLDER", `Duplicate placeholder ${placeholder.token}`));
    }
  }

  for (const placeholder of missingTokenPlaceholders) {
    rawCounts.set(placeholder.value, countToken(result.translation, placeholder.value));
  }

  const consumedRawCounts = new Map<string, number>();
  for (const placeholder of missingTokenPlaceholders) {
    const consumed = consumedRawCounts.get(placeholder.value) ?? 0;
    const available = rawCounts.get(placeholder.value) ?? 0;
    if (available <= consumed && placeholder.required) {
      issues.push(issue(unit.id, "error", "MISSING_PLACEHOLDER", `Missing placeholder ${placeholder.token}`));
      continue;
    }
    consumedRawCounts.set(placeholder.value, consumed + 1);
  }

  for (const [rawValue, available] of rawCounts.entries()) {
    const consumed = consumedRawCounts.get(rawValue) ?? 0;
    if (available > consumed) {
      issues.push(issue(unit.id, "error", "DUPLICATE_PLACEHOLDER", `Duplicate raw placeholder value ${rawValue}`));
    }
  }

  for (const token of result.translation.match(/<PH_\d+>/g) ?? []) {
    if (!expectedTokens.has(token)) {
      issues.push(issue(unit.id, "error", "EXTRA_PLACEHOLDER", `Unexpected placeholder ${token}`));
    }
  }

  const restored = restorePlaceholders(result.translation, placeholders);
  for (const placeholder of placeholders.filter((item) => item.kind === "control-code")) {
    if (!restored.includes(placeholder.value)) {
      issues.push(issue(unit.id, "error", "CONTROL_CODE_CHANGED", `Control code changed: ${placeholder.value}`));
    }
  }
}

function validateNumbers(unit: TranslationUnit, result: TranslationResult, issues: ValidationIssue[]): void {
  const sourceNumbers = extractNumbers(unit.source);
  const translatedNumbers = extractNumbers(restorePlaceholders(result.translation, unit.placeholders));

  if (!sameMultiset(sourceNumbers, translatedNumbers)) {
    issues.push(issue(unit.id, "warning", "NUMBER_CHANGED", "Numbers differ between source and translation"));
  }
}

function validateVariables(unit: TranslationUnit, result: TranslationResult, issues: ValidationIssue[]): void {
  const sourceVariables = extractVariables(unit.source);
  const translatedVariables = extractVariables(restorePlaceholders(result.translation, unit.placeholders));

  if (!sameMultiset(sourceVariables, translatedVariables)) {
    issues.push(issue(unit.id, "error", "VARIABLE_CHANGED", "Variables differ between source and translation"));
  }
}

function validateTechnicalTokens(unit: TranslationUnit, result: TranslationResult, issues: ValidationIssue[]): void {
  const sourceTokens = extractTechnicalTokens(unit.source);
  const translatedTokens = extractTechnicalTokens(restorePlaceholders(result.translation, unit.placeholders));

  if (!sameMultiset(sourceTokens, translatedTokens)) {
    issues.push(issue(unit.id, "warning", "TECHNICAL_TOKEN_CHANGED", "Technical tokens differ between source and translation"));
  }
}

function validateConstraints(unit: TranslationUnit, result: TranslationResult, issues: ValidationIssue[]): void {
  const { maxLength, maxLines } = unit.constraints ?? {};

  if (maxLength != null && result.translation.length > maxLength) {
    issues.push(issue(unit.id, "warning", "MAX_LENGTH_EXCEEDED", `Translation exceeds maxLength ${maxLength}`));
  }

  if (maxLines != null && result.translation.split(/\r?\n/).length > maxLines) {
    issues.push(issue(unit.id, "warning", "MAX_LINES_EXCEEDED", `Translation exceeds maxLines ${maxLines}`));
  }
}

function validateGlossary(
  unit: TranslationUnit,
  result: TranslationResult,
  issues: ValidationIssue[],
  glossary?: Glossary
): void {
  if (!glossary) {
    return;
  }

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
}

function extractNumbers(text: string): string[] {
  return text.match(/\d+(?:[.,]\d+)?%?/g) ?? [];
}

function extractVariables(text: string): string[] {
  return text.match(/\\[VNP]\[\d+\]|\{[A-Za-z_][A-Za-z0-9_]*\}/g) ?? [];
}

function extractTechnicalTokens(text: string): string[] {
  return text.match(/\\(?:[VNPIC]\[\d+\]|G|\{|\}|\.|\||!|>)|%(?:\d+|(?:\.\d+)?[sdif])|\{[A-Za-z_][A-Za-z0-9_]*\}|<[^<>\n]+>/g) ?? [];
}

function sameMultiset(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const counts = new Map<string, number>();
  for (const item of left) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }

  for (const item of right) {
    const count = counts.get(item);
    if (!count) {
      return false;
    }
    if (count === 1) {
      counts.delete(item);
    } else {
      counts.set(item, count - 1);
    }
  }

  return counts.size === 0;
}

function issue(
  id: string,
  severity: ValidationIssue["severity"],
  code: ValidationIssue["code"],
  message: string
): ValidationIssue {
  return { id, severity, code, message };
}
