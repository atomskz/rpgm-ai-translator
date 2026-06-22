import type { ValidationIssue } from "../../types.js";
import { protectPlaceholders } from "../../placeholders/index.js";

export function issue(
  id: string,
  severity: ValidationIssue["severity"],
  code: ValidationIssue["code"],
  message: string
): ValidationIssue {
  return { id, severity, code, message };
}

export function extractNumbers(text: string): string[] {
  return text.match(/\d+(?:[.,]\d+)?%?/g) ?? [];
}

// In-game numbers are the ones shown to the player as prose. Digits that belong
// to a control code, variable or placeholder (the 4 in `\C[4]`, the 1 in
// `\V[1]` or `<PH_1>`) are not in-game numbers, so strip every protected token
// before counting. Works whether the translation still holds `<PH_n>` tokens or
// has been restored to real control codes.
export function extractProseNumbers(text: string): string[] {
  const prose = protectPlaceholders(text).text.replace(/<PH_\d+>/g, " ");
  return extractNumbers(prose);
}

export function extractVariables(text: string): string[] {
  return text.match(/\\[VNP]\[\d+\]|\{[A-Za-z_][A-Za-z0-9_]*\}/g) ?? [];
}

export function extractTechnicalTokens(text: string): string[] {
  return text.match(/\\(?:[A-Za-z]+(?:\[[^\]\r\n]*\])?|\{|\}|\.|\||!|>)|%(?:\d+|(?:\.\d+)?[sdif])|\{[A-Za-z_][A-Za-z0-9_]*\}|<[^<>\n]+>/g) ?? [];
}

export function sameMultiset(left: string[], right: string[]): boolean {
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
