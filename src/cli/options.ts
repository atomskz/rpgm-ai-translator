import type { ValidationIssue } from "../core/types.js";

export function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export function readPositiveIntegerOption(args: string[], name: string): number | undefined {
  const value = readOption(args, name);
  if (value == null) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function readNonNegativeIntegerOption(args: string[], name: string): number | undefined {
  const value = readOption(args, name);
  if (value == null) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

export function readNumberOption(
  args: string[],
  name: string,
  options: { min?: number; max?: number } = {}
): number | undefined {
  const value = readOption(args, name);
  if (value == null) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number`);
  }
  if (options.min != null && parsed < options.min) {
    throw new Error(`${name} must be greater than or equal to ${options.min}`);
  }
  if (options.max != null && parsed > options.max) {
    throw new Error(`${name} must be less than or equal to ${options.max}`);
  }
  return parsed;
}

export function readIssueCodesOption(args: string[], name: string): ValidationIssue["code"][] | undefined {
  const value = readOption(args, name);
  if (value == null) {
    return undefined;
  }

  const codes = value
    .split(",")
    .map((code) => code.trim())
    .filter((code) => code.length > 0);
  for (const code of codes) {
    if (!isValidationIssueCode(code)) {
      throw new Error(`${name} contains unknown validation issue code '${code}'`);
    }
  }
  return codes as ValidationIssue["code"][];
}

export function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

export function requireArg(value: string | undefined, label: string): string {
  if (!value) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}

export function requireOption(args: string[], name: string): string {
  const value = readOption(args, name);
  if (!value) {
    throw new Error(`Missing required option ${name}`);
  }
  return value;
}

export function assertProviderReady(providerName: string): void {
  if (providerName === "deepseek" && !process.env.DEEPSEEK_API_KEY?.trim()) {
    throw new Error("DEEPSEEK_API_KEY is required when using --provider deepseek");
  }
}

function isValidationIssueCode(value: string): value is ValidationIssue["code"] {
  return VALIDATION_ISSUE_CODES.has(value as ValidationIssue["code"]);
}

const VALIDATION_ISSUE_CODES = new Set<ValidationIssue["code"]>([
  "INVALID_JSON",
  "ID_MISMATCH",
  "UNKNOWN_TRANSLATION_ID",
  "MISSING_TRANSLATION",
  "MISSING_PLACEHOLDER",
  "EXTRA_PLACEHOLDER",
  "DUPLICATE_PLACEHOLDER",
  "CONTROL_CODE_CHANGED",
  "NUMBER_CHANGED",
  "VARIABLE_CHANGED",
  "MAX_LENGTH_EXCEEDED",
  "MAX_LINES_EXCEEDED",
  "EMPTY_TRANSLATION",
  "UNCHANGED_TRANSLATION",
  "GLOSSARY_VIOLATION",
  "TECHNICAL_TOKEN_CHANGED"
]);
