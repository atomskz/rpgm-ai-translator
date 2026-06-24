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

const SUPPORTED_PROVIDERS = ["mock", "deepseek"] as const;

// Validate the provider name up front so an unknown value (or `none` on a command
// that does not support it) fails before any side effects such as writing a
// checkpoint, instead of throwing deep inside createProvider. `none` is only
// meaningful to the characters command, which handles it before calling this.
export function assertProviderReady(providerName: string): void {
  if (!(SUPPORTED_PROVIDERS as readonly string[]).includes(providerName)) {
    const hint =
      providerName === "none"
        ? " ('none' builds a heuristic glossary and is only valid for the characters command, like --draft-only)"
        : "";
    throw new UsageError(`Unknown provider '${providerName}'. Supported: ${SUPPORTED_PROVIDERS.join(", ")}${hint}.`);
  }
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
    includeSpeakerNames: hasFlag(args, "--include-speaker-names"),
    dialogueMaxLength: readPositiveIntegerOption(args, "--dialogue-max-length")
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
    includeEventComments: hasFlag(args, "--include-comments"),
    includePlugins: hasFlag(args, "--include-plugins"),
    includeSpeakerNames: hasFlag(args, "--include-speaker-names"),
    dialogueMaxLength: readPositiveIntegerOption(args, "--dialogue-max-length"),
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
  // How many positional arguments the command reads. Anything past this is a
  // mistake (e.g. a flag value mistyped without `--`, or translations passed
  // positionally to characters) and is rejected rather than silently dropped.
  maxPositionals: number;
  // Appended to the "too many arguments" error when the extra positional is a
  // common confusion (characters takes translations via --translations).
  extraPositionalHint?: string;
  // Alternate spellings accepted for a value option, mapped to the canonical flag,
  // so run honours repair's --codes/--attempts without listing duplicates in --help.
  aliases?: Readonly<Record<string, string>>;
};

// Allowed options per command, mirroring exactly what each command handler reads.
// Used to reject unknown flags, missing values, and duplicate value options before
// a command runs, so a typo silently falls back to a default no longer. Also the
// single source of truth for which flags per-command help lists.
export const COMMAND_OPTION_SPECS: Record<string, CommandOptionSpec> = {
  detect: { valueOptions: [], booleanFlags: [], maxPositionals: 1 },
  extract: {
    valueOptions: ["--out", "--report", "--dialogue-max-length"],
    booleanFlags: ["--include-comments", "--include-plugins", "--include-speaker-names"],
    maxPositionals: 1
  },
  translate: {
    valueOptions: [
      "--provider", "--base-url", "--target", "--model", "--batch-size", "--timeout-ms", "--temperature",
      "--max-tokens", "--max-tokens-budget", "--retry-attempts", "--out", "--checkpoint", "--report", "--memory", "--glossary"
    ],
    booleanFlags: [],
    maxPositionals: 1
  },
  characters: {
    valueOptions: [
      "--out", "--translations", "--provider", "--base-url", "--target", "--model", "--batch-size",
      "--timeout-ms", "--temperature", "--max-tokens", "--max-tokens-budget"
    ],
    booleanFlags: ["--draft-only", "--include-mentions"],
    maxPositionals: 1,
    extraPositionalHint: "characters reads only <units.json>; pass the translations file via --translations."
  },
  review: {
    valueOptions: [
      "--provider", "--base-url", "--target", "--model", "--batch-size", "--timeout-ms", "--temperature",
      "--max-tokens", "--out", "--checkpoint", "--glossary", "--characters"
    ],
    booleanFlags: [],
    maxPositionals: 2
  },
  validate: {
    valueOptions: ["--out", "--glossary"],
    booleanFlags: [],
    maxPositionals: 2
  },
  repair: {
    valueOptions: [
      "--report", "--out", "--provider", "--base-url", "--target", "--model", "--batch-size", "--timeout-ms",
      "--temperature", "--max-tokens", "--checkpoint", "--glossary", "--characters", "--codes", "--attempts"
    ],
    booleanFlags: [],
    maxPositionals: 2
  },
  apply: {
    valueOptions: ["--mode", "--out", "--backup", "--font", "--number-font", "--report", "--units", "--dialogue-max-length"],
    booleanFlags: ["--include-comments", "--include-plugins", "--include-speaker-names", "--dry-run"],
    maxPositionals: 2
  },
  run: {
    valueOptions: [
      "--out", "--work-dir", "--provider", "--base-url", "--target", "--model", "--batch-size", "--timeout-ms", "--temperature",
      "--max-tokens", "--max-tokens-budget", "--retry-attempts", "--memory", "--glossary", "--characters", "--repair-attempts",
      "--repair-codes", "--font", "--number-font", "--mode", "--backup", "--dialogue-max-length"
    ],
    booleanFlags: ["--include-comments", "--include-plugins", "--include-speaker-names", "--review", "--repair", "--dry-run"],
    maxPositionals: 1,
    // Accept repair's flag names so muscle memory transfers between the commands.
    aliases: { "--codes": "--repair-codes", "--attempts": "--repair-attempts" }
  },
  "patch-font": {
    valueOptions: ["--out", "--font", "--number-font"],
    booleanFlags: [],
    maxPositionals: 1
  }
};

// Options accepted by every command. --config selects a project config file and
// is consumed before dispatch (see runCli); --verbose enables stack/cause output
// on error. Both are handled outside command handlers, so they must not be
// flagged as unknown options.
export const GLOBAL_VALUE_OPTIONS: readonly string[] = ["--config"];
export const GLOBAL_BOOLEAN_FLAGS: readonly string[] = ["--verbose"];

// Every value-taking option across all commands, so a flag's value can be skipped
// when collecting positionals. No flag is a value option in one command and a
// boolean in another, so a single shared set is unambiguous.
const ALL_VALUE_OPTIONS = new Set<string>([
  ...Object.values(COMMAND_OPTION_SPECS).flatMap((spec) => [...spec.valueOptions]),
  ...GLOBAL_VALUE_OPTIONS
]);

// Collect positional arguments regardless of where they sit relative to options,
// so `translate --provider mock units.json` works as well as
// `translate units.json --provider mock`. Unknown flags are already rejected by
// validateCommandArgs before a handler runs, so any remaining `--` token is a
// known flag (and its value, for value options, is skipped here).
export function readPositionals(args: string[]): string[] {
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token.startsWith("--")) {
      if (ALL_VALUE_OPTIONS.has(token)) {
        index += 1;
      }
      continue;
    }
    positionals.push(token);
  }
  return positionals;
}

export function requirePositional(args: string[], index: number, label: string): string {
  return requireArg(readPositionals(args)[index], label);
}

export function validateCommandArgs(command: string, args: string[]): void {
  const spec = COMMAND_OPTION_SPECS[command];
  if (!spec) {
    return;
  }
  const aliases = spec.aliases ?? {};
  const valueOptions = new Set<string>([...spec.valueOptions, ...Object.keys(aliases), ...GLOBAL_VALUE_OPTIONS]);
  const booleanFlags = new Set<string>([...spec.booleanFlags, ...GLOBAL_BOOLEAN_FLAGS]);
  const knownOptions = [
    ...spec.valueOptions,
    ...Object.keys(aliases),
    ...GLOBAL_VALUE_OPTIONS,
    ...spec.booleanFlags,
    ...GLOBAL_BOOLEAN_FLAGS
  ];
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
      // Collapse an alias to its canonical flag so --codes and --repair-codes
      // count as the same option rather than slipping past as two distinct ones.
      const canonicalToken = aliases[token] ?? token;
      if (seenValueOptions.has(canonicalToken)) {
        throw new UsageError(`Option ${token} was provided more than once`);
      }
      seenValueOptions.add(canonicalToken);
      const value = args[index + 1];
      // Reject a missing value, the next flag standing in for one, and an
      // empty/whitespace value (e.g. --target "") that would otherwise slip past
      // `readOption(...) ?? default` as a non-nullish empty string.
      if (value === undefined || value.startsWith("--") || value.trim().length === 0) {
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

  // Reject surplus positionals so a mistyped flag value or a file passed in the
  // wrong slot fails loudly instead of being silently ignored.
  const positionals = readPositionals(args);
  if (positionals.length > spec.maxPositionals) {
    const extra = positionals.slice(spec.maxPositionals).map((value) => `'${value}'`).join(", ");
    const plural = positionals.length - spec.maxPositionals > 1 ? "s" : "";
    const base = `Unexpected argument${plural} ${extra} for '${command}'.`;
    throw new UsageError(spec.extraPositionalHint ? `${base} ${spec.extraPositionalHint}` : base);
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

export function isValidationIssueCode(value: string): value is ValidationIssue["code"] {
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
  "PROVIDER_RESPONSE_SCHEMA_ERROR",
  "PROVIDER_RESPONSE_ID_ANOMALY"
]);
