import type { ApplyOptions, ExtractOptions, TranslateOptions, ValidationIssue } from "../core/types.js";

// Marks errors caused by bad command-line input (missing/unknown/invalid
// arguments) so the CLI can attach the command usage and a --help hint, as
// opposed to runtime failures where that guidance would be noise.
export class UsageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "UsageError";
  }
}

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
    throw new UsageError(`${name} must be a positive integer`);
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
    throw new UsageError(`${name} must be a non-negative integer`);
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
    throw new UsageError(`${name} must be a number`);
  }
  if (options.min != null && parsed < options.min) {
    throw new UsageError(`${name} must be greater than or equal to ${options.min}`);
  }
  if (options.max != null && parsed > options.max) {
    throw new UsageError(`${name} must be less than or equal to ${options.max}`);
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
      throw new UsageError(`${name} contains unknown validation issue code '${code}'`);
    }
  }
  return codes as ValidationIssue["code"][];
}

export function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

export function requireArg(value: string | undefined, label: string): string {
  if (!value) {
    throw new UsageError(`Missing ${label}`);
  }
  return value;
}

export function requireOption(args: string[], name: string): string {
  const value = readOption(args, name);
  if (!value) {
    throw new UsageError(`Missing required option ${name}`);
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

export function readProviderConfig(args: string[]): { baseUrl?: string } {
  return { baseUrl: readOption(args, "--base-url") };
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

const APPLY_MODES = ["patch", "in-place"] as const;

export function readApplyMode(args: string[]): ApplyOptions["mode"] {
  const value = readOption(args, "--mode");
  if (value == null) {
    return "patch";
  }
  if (!(APPLY_MODES as readonly string[]).includes(value)) {
    throw new UsageError(`--mode must be one of ${APPLY_MODES.join(", ")}, got '${value}'`);
  }
  return value as ApplyOptions["mode"];
}

export function readApplyOptions(args: string[]): ApplyOptions {
  return {
    mode: readApplyMode(args),
    outDir: readOption(args, "--out"),
    backupDir: readOption(args, "--backup"),
    includePlugins: hasFlag(args, "--include-plugins"),
    includeSpeakerNames: hasFlag(args, "--include-speaker-names"),
    dryRun: hasFlag(args, "--dry-run")
  };
}

export function readFontOptions(args: string[]): FontCliOptions {
  return {
    fontPath: readOption(args, "--font"),
    numberFontPath: readOption(args, "--number-font")
  };
}

export type CommandOptionSpec = {
  valueOptions: readonly string[];
  booleanFlags: readonly string[];
};

// Allowed options per command, mirroring exactly what each command handler reads.
// Used to reject unknown flags, missing values, and duplicate value options before
// a command runs, so a typo silently falls back to a default no longer. Also the
// single source of truth for which flags per-command help lists.
export const COMMAND_OPTION_SPECS: Record<string, CommandOptionSpec> = {
  detect: { valueOptions: [], booleanFlags: [] },
  extract: {
    valueOptions: ["--out", "--report"],
    booleanFlags: ["--include-comments", "--include-plugins", "--include-speaker-names"]
  },
  translate: {
    valueOptions: [
      "--provider", "--base-url", "--target", "--model", "--batch-size", "--timeout-ms", "--temperature",
      "--max-tokens", "--max-tokens-budget", "--retry-attempts", "--out", "--checkpoint", "--report", "--memory", "--glossary"
    ],
    booleanFlags: []
  },
  characters: {
    valueOptions: [
      "--out", "--translations", "--provider", "--base-url", "--target", "--model", "--batch-size",
      "--timeout-ms", "--temperature", "--max-tokens"
    ],
    booleanFlags: ["--draft-only", "--include-mentions"]
  },
  review: {
    valueOptions: [
      "--provider", "--base-url", "--target", "--model", "--batch-size", "--timeout-ms", "--temperature",
      "--max-tokens", "--out", "--checkpoint", "--glossary", "--characters"
    ],
    booleanFlags: []
  },
  validate: {
    valueOptions: ["--out", "--glossary"],
    booleanFlags: []
  },
  repair: {
    valueOptions: [
      "--report", "--out", "--provider", "--base-url", "--target", "--model", "--batch-size", "--timeout-ms",
      "--temperature", "--max-tokens", "--checkpoint", "--glossary", "--characters", "--codes", "--attempts"
    ],
    booleanFlags: []
  },
  apply: {
    valueOptions: ["--mode", "--out", "--backup", "--font", "--number-font", "--report", "--units"],
    booleanFlags: ["--include-plugins", "--include-speaker-names", "--dry-run"]
  },
  run: {
    valueOptions: [
      "--out", "--work-dir", "--provider", "--base-url", "--target", "--model", "--batch-size", "--timeout-ms", "--temperature",
      "--max-tokens", "--max-tokens-budget", "--retry-attempts", "--memory", "--glossary", "--characters", "--repair-attempts",
      "--repair-codes", "--font", "--number-font", "--mode", "--backup"
    ],
    booleanFlags: ["--include-comments", "--include-plugins", "--include-speaker-names", "--review", "--repair", "--dry-run"]
  },
  "patch-font": {
    valueOptions: ["--out", "--font", "--number-font"],
    booleanFlags: []
  }
};

// Options accepted by every command. --config selects a project config file and
// is consumed before dispatch (see runCli); --verbose enables stack/cause output
// on error. Both are handled outside command handlers, so they must not be
// flagged as unknown options.
export const GLOBAL_VALUE_OPTIONS: readonly string[] = ["--config"];
export const GLOBAL_BOOLEAN_FLAGS: readonly string[] = ["--verbose"];

export function validateCommandArgs(command: string, args: string[]): void {
  const spec = COMMAND_OPTION_SPECS[command];
  if (!spec) {
    return;
  }
  const valueOptions = new Set<string>([...spec.valueOptions, ...GLOBAL_VALUE_OPTIONS]);
  const booleanFlags = new Set<string>([...spec.booleanFlags, ...GLOBAL_BOOLEAN_FLAGS]);
  const knownOptions = [...spec.valueOptions, ...GLOBAL_VALUE_OPTIONS, ...spec.booleanFlags, ...GLOBAL_BOOLEAN_FLAGS];
  const seenValueOptions = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      continue;
    }
    if (token === "--help") {
      continue;
    }
    if (booleanFlags.has(token)) {
      continue;
    }
    if (valueOptions.has(token)) {
      if (seenValueOptions.has(token)) {
        throw new UsageError(`Option ${token} was provided more than once`);
      }
      seenValueOptions.add(token);
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new UsageError(`${token} requires a value`);
      }
      index += 1;
      continue;
    }
    const suggestion = closestKnownOption(token, knownOptions);
    throw new UsageError(
      suggestion
        ? `Unknown option ${token}. Did you mean ${suggestion}?`
        : `Unknown option ${token} for '${command}'`
    );
  }
}

function closestKnownOption(token: string, knownOptions: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of knownOptions) {
    const distance = levenshteinDistance(token, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best !== undefined && bestDistance <= 2 ? best : undefined;
}

function levenshteinDistance(a: string, b: string): number {
  const matrix = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) {
    matrix[i][0] = i;
  }
  for (let j = 0; j <= b.length; j += 1) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return matrix[a.length][b.length];
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
