import type { ApplyOptions, ExtractOptions, TranslateOptions, ValidationIssue } from "../core/types.js";

export type ProviderCliOptions = Pick<
  TranslateOptions,
  "targetLanguage" | "model" | "batchSize" | "timeoutMs" | "temperature" | "maxTokens"
>;

export type TranslateCliOptions = ProviderCliOptions & Pick<TranslateOptions, "retryAttempts">;

export type FontCliOptions = {
  fontPath?: string;
  numberFontPath?: string;
};

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

export function readProviderName(args: string[], defaultProvider = "mock"): string {
  return readOption(args, "--provider") ?? defaultProvider;
}

export function readProviderCliOptions(args: string[]): ProviderCliOptions {
  return {
    targetLanguage: readOption(args, "--target") ?? "ru",
    model: readOption(args, "--model"),
    batchSize: readPositiveIntegerOption(args, "--batch-size"),
    timeoutMs: readPositiveIntegerOption(args, "--timeout-ms"),
    temperature: readNumberOption(args, "--temperature", { min: 0, max: 2 }),
    maxTokens: readPositiveIntegerOption(args, "--max-tokens")
  };
}

export function readTranslateCliOptions(args: string[]): TranslateCliOptions {
  return {
    ...readProviderCliOptions(args),
    retryAttempts: readNonNegativeIntegerOption(args, "--retry-attempts")
  };
}

export function readExtractOptions(args: string[]): ExtractOptions {
  return {
    includeEventComments: hasFlag(args, "--include-comments"),
    includePlugins: hasFlag(args, "--include-plugins"),
    includeSpeakerNames: hasFlag(args, "--include-speaker-names")
  };
}

export function readApplyOptions(args: string[]): ApplyOptions {
  return {
    mode: (readOption(args, "--mode") ?? "patch") as ApplyOptions["mode"],
    outDir: readOption(args, "--out"),
    backupDir: readOption(args, "--backup"),
    includePlugins: hasFlag(args, "--include-plugins"),
    includeSpeakerNames: hasFlag(args, "--include-speaker-names")
  };
}

export function readFontOptions(args: string[]): FontCliOptions {
  return {
    fontPath: readOption(args, "--font"),
    numberFontPath: readOption(args, "--number-font")
  };
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
  "TECHNICAL_TOKEN_CHANGED",
  "PROVIDER_AUTH_ERROR",
  "PROVIDER_BILLING_ERROR",
  "PROVIDER_RATE_LIMIT",
  "PROVIDER_TIMEOUT",
  "PROVIDER_NETWORK_ERROR",
  "PROVIDER_SERVER_ERROR",
  "PROVIDER_REQUEST_ERROR",
  "PROVIDER_RESPONSE_ERROR",
  "PROVIDER_RESPONSE_SCHEMA_ERROR"
]);
