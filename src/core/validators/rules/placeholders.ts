import type { TranslationResult, TranslationUnit, ValidationIssue } from "../../types.js";
import { countToken, restorePlaceholders } from "../../placeholders/index.js";
import { issue } from "./shared.js";

export function validatePlaceholders(unit: TranslationUnit, result: TranslationResult): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
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

  return issues;
}
