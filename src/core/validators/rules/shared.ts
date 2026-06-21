import type { ValidationIssue } from "../../types.js";

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
