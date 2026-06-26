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

import { applyCommand } from "./commands/apply.js";
import { charactersCommand } from "./commands/characters.js";
import { cleanCommand } from "./commands/clean.js";
import { configCommand } from "./commands/config.js";
import { detectCommand } from "./commands/detect.js";
import { diffCommand } from "./commands/diff.js";
import { doctorCommand } from "./commands/doctor.js";
import { estimateCommand } from "./commands/estimate.js";
import { glossaryCommand } from "./commands/glossary.js";
import { initCommand } from "./commands/init.js";
import { memoryCommand } from "./commands/memory.js";
import { reportCommand } from "./commands/report.js";
import { statusCommand } from "./commands/status.js";
import { extractCommand } from "./commands/extract.js";
import { patchFontCommand } from "./commands/patch-font.js";
import { repairCommand } from "./commands/repair.js";
import { reviewCommand } from "./commands/review.js";
import { runCommand } from "./commands/run.js";
import { translateCommand } from "./commands/translate.js";
import { validateCommand } from "./commands/validate.js";
import { verifyCommand } from "./commands/verify.js";
import { loadProjectConfig } from "../config/public-api.js";
import { mergeConfigIntoArgs } from "./config-args.js";
import { commandHelp, commandUsage, helpText } from "./help.js";
import { GLOBAL_BOOLEAN_FLAGS, GLOBAL_VALUE_OPTIONS, readOption, UsageError, validateCommandArgs } from "./options/public-api.js";
import type { CliIO, CommandHandler } from "./types.js";

export type { CliIO } from "./types.js";
export { helpText } from "./help.js";

const COMMANDS = new Map<string, CommandHandler>([
  ["init", initCommand],
  ["doctor", doctorCommand],
  ["config", configCommand],
  ["memory", memoryCommand],
  ["report", reportCommand],
  ["diff", diffCommand],
  ["estimate", estimateCommand],
  ["status", statusCommand],
  ["clean", cleanCommand],
  ["glossary", glossaryCommand],
  ["detect", detectCommand],
  ["extract", extractCommand],
  ["translate", translateCommand],
  ["characters", charactersCommand],
  ["review", reviewCommand],
  ["validate", validateCommand],
  ["repair", repairCommand],
  ["apply", applyCommand],
  ["patch-font", patchFontCommand],
  ["verify", verifyCommand],
  ["run", runCommand]
]);

// Peel global flags (--verbose, --config <value>) off the front of argv so they
// can precede the subcommand. Stops at the first non-global token, which is the
// command. Globals after the command are left in place and handled as usual.
function splitLeadingGlobalArgs(argv: string[]): { leading: string[]; rest: string[] } {
  const valueGlobals = new Set<string>(GLOBAL_VALUE_OPTIONS);
  const booleanGlobals = new Set<string>(GLOBAL_BOOLEAN_FLAGS);
  const leading: string[] = [];
  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (booleanGlobals.has(token)) {
      leading.push(token);
      index += 1;
    } else if (valueGlobals.has(token) && index + 1 < argv.length) {
      leading.push(token, argv[index + 1]);
      index += 2;
    } else {
      break;
    }
  }
  return { leading, rest: argv.slice(index) };
}

export async function runCli(argv: string[], io: CliIO = defaultIO): Promise<number> {
  // Accept global flags before the subcommand (e.g. `--verbose translate ...`):
  // strip the leading globals, dispatch on the next token, and append the globals
  // to the command's args so they are still honored. Without this the leading flag
  // was read as the command and reported as "Unknown command: --verbose".
  const { leading, rest } = splitLeadingGlobalArgs(argv);
  const [command, ...commandArgs] = rest;
  const args = [...commandArgs, ...leading];

  try {
    if (!command || command === "--help" || command === "-h" || command === "help") {
      io.stdout(helpText());
      return 0;
    }

    const handler = COMMANDS.get(command);
    if (!handler) {
      io.stderr(`Unknown command: ${command}\n\n${helpText()}`);
      return 1;
    }

    if (args.includes("--help") || args.includes("-h")) {
      io.stdout(commandHelp(command));
      return 0;
    }

    // `config` inspects the project config itself (including reporting a malformed
    // file), and `memory` is a file-maintenance command whose --provider/--model
    // are prune filters that must not be filled in from the translation config.
    // Both skip the usual pre-load+merge and run on the raw args.
    if (command === "config" || command === "memory") {
      validateCommandArgs(command, args);
      return await handler(args, io);
    }

    // Project config fills in flags the user did not pass; explicit CLI flags
    // still take precedence because mergeConfigIntoArgs only adds absent ones.
    const config = await loadProjectConfig(process.cwd(), readOption(args, "--config"), (warning) =>
      io.stderr(`Warning: ${warning}\n`)
    );
    const effectiveArgs = mergeConfigIntoArgs(command, args, config);

    validateCommandArgs(command, effectiveArgs);
    return await handler(effectiveArgs, io);
  } catch (error: unknown) {
    io.stderr(`${formatCliError(error, command, args.includes("--verbose"))}\n`);
    return 1;
  }
}

// Build the message printed for a failed command. Usage errors get the command
// usage line plus a --help hint; --verbose adds the stack and the full cause
// chain. Without --verbose only the human-readable message is shown.
function formatCliError(error: unknown, command: string | undefined, verbose: boolean): string {
  const lines = [error instanceof Error ? error.message : String(error)];

  if (error instanceof UsageError && command) {
    const usage = commandUsage(command);
    if (usage) {
      lines.push("", `Usage: rpgm-ai-translator ${usage}`);
    }
    lines.push(`Run 'rpgm-ai-translator ${command} --help' for details.`);
  }

  if (verbose) {
    if (error instanceof Error && error.stack) {
      lines.push("", error.stack);
    }
    const seen = new Set<unknown>([error]);
    let cause = (error as { cause?: unknown })?.cause;
    while (cause != null && !seen.has(cause)) {
      seen.add(cause);
      const causeError = cause instanceof Error ? cause : undefined;
      lines.push("", `Caused by: ${causeError ? causeError.stack ?? causeError.message : String(cause)}`);
      cause = (cause as { cause?: unknown }).cause;
    }
  }

  return lines.join("\n");
}

const defaultIO: CliIO = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text)
};
