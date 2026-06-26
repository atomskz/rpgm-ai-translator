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

import { requireArg } from "./readers.js";
import { UsageError } from "./usage-error.js";

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
  init: { valueOptions: ["--out"], booleanFlags: ["--force"], maxPositionals: 0 },
  doctor: {
    valueOptions: [
      "--provider", "--base-url", "--api-dialect", "--target", "--model", "--batch-size", "--timeout-ms", "--temperature", "--max-tokens", "--thinking"
    ],
    booleanFlags: [],
    maxPositionals: 1
  },
  config: { valueOptions: [], booleanFlags: [], maxPositionals: 2 },
  memory: { valueOptions: ["--memory", "--before", "--model", "--provider"], booleanFlags: [], maxPositionals: 1 },
  report: { valueOptions: ["--units", "--translations", "--out"], booleanFlags: [], maxPositionals: 2 },
  diff: { valueOptions: ["--out"], booleanFlags: [], maxPositionals: 3 },
  estimate: { valueOptions: ["--batch-size", "--price-per-1k"], booleanFlags: [], maxPositionals: 1 },
  status: {
    valueOptions: [
      "--out", "--work-dir", "--provider", "--base-url", "--api-dialect", "--target", "--model", "--batch-size",
      "--timeout-ms", "--temperature", "--max-tokens", "--thinking", "--glossary", "--characters", "--dialogue-max-length"
    ],
    booleanFlags: ["--include-comments", "--include-plugins", "--include-speaker-names", "--include-notes"],
    maxPositionals: 1
  },
  clean: {
    valueOptions: ["--out", "--work-dir"],
    booleanFlags: ["--checkpoints", "--with-memory", "--lock", "--all", "--dry-run"],
    maxPositionals: 0
  },
  detect: { valueOptions: [], booleanFlags: [], maxPositionals: 1 },
  extract: {
    valueOptions: ["--out", "--report", "--dialogue-max-length"],
    booleanFlags: ["--include-comments", "--include-plugins", "--include-speaker-names", "--include-notes"],
    maxPositionals: 1
  },
  translate: {
    valueOptions: [
      "--provider", "--base-url", "--api-dialect", "--target", "--model", "--batch-size", "--timeout-ms", "--temperature",
      "--max-tokens", "--thinking", "--max-tokens-budget", "--retry-attempts", "--concurrency", "--out", "--checkpoint", "--report", "--memory", "--glossary"
    ],
    booleanFlags: [],
    maxPositionals: 1
  },
  characters: {
    valueOptions: [
      "--out", "--translations", "--provider", "--base-url", "--api-dialect", "--target", "--model", "--batch-size",
      "--timeout-ms", "--temperature", "--max-tokens", "--thinking", "--max-tokens-budget"
    ],
    booleanFlags: ["--draft-only", "--include-mentions"],
    // <units.json> [translations.json]; --translations is a deprecated alias for
    // the second positional. (The check subcommand uses `characters check <file>`.)
    maxPositionals: 2
  },
  review: {
    valueOptions: [
      "--provider", "--base-url", "--api-dialect", "--target", "--model", "--batch-size", "--timeout-ms", "--temperature",
      "--max-tokens", "--thinking", "--out", "--checkpoint", "--glossary", "--characters"
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
      "--report", "--out", "--provider", "--base-url", "--api-dialect", "--target", "--model", "--batch-size", "--timeout-ms",
      "--temperature", "--max-tokens", "--thinking", "--checkpoint", "--glossary", "--characters", "--codes", "--attempts"
    ],
    booleanFlags: [],
    maxPositionals: 2,
    // Accept run's flag names (and the config keys repairCodes/repairAttempts,
    // which inject as --repair-codes/--repair-attempts) so the same config reaches
    // both commands and muscle memory transfers between them.
    aliases: { "--repair-codes": "--codes", "--repair-attempts": "--attempts" }
  },
  apply: {
    valueOptions: ["--mode", "--out", "--backup", "--font", "--number-font", "--report", "--units", "--dialogue-max-length"],
    booleanFlags: ["--include-comments", "--include-plugins", "--include-speaker-names", "--include-notes", "--dry-run", "--force"],
    maxPositionals: 2
  },
  run: {
    valueOptions: [
      "--out", "--work-dir", "--provider", "--base-url", "--api-dialect", "--target", "--model", "--batch-size", "--timeout-ms", "--temperature",
      "--max-tokens", "--thinking", "--max-tokens-budget", "--retry-attempts", "--concurrency", "--memory", "--glossary", "--characters", "--from-translations", "--repair-attempts",
      "--repair-codes", "--font", "--number-font", "--mode", "--backup", "--dialogue-max-length", "--price-per-1k"
    ],
    booleanFlags: ["--include-comments", "--include-plugins", "--include-speaker-names", "--include-notes", "--review", "--repair", "--dry-run", "--force"],
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
