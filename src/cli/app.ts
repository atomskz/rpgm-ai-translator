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
import { detectCommand } from "./commands/detect.js";
import { extractCommand } from "./commands/extract.js";
import { patchFontCommand } from "./commands/patch-font.js";
import { repairCommand } from "./commands/repair.js";
import { reviewCommand } from "./commands/review.js";
import { runCommand } from "./commands/run.js";
import { translateCommand } from "./commands/translate.js";
import { validateCommand } from "./commands/validate.js";
import { loadProjectConfig, mergeConfigIntoArgs } from "../config/project.js";
import { commandHelp, commandUsage, helpText } from "./help.js";
import { readOption, UsageError, validateCommandArgs } from "./options.js";
import type { CliIO, CommandHandler } from "./types.js";

export type { CliIO } from "./types.js";
export { helpText } from "./help.js";

const COMMANDS = new Map<string, CommandHandler>([
  ["detect", detectCommand],
  ["extract", extractCommand],
  ["translate", translateCommand],
  ["characters", charactersCommand],
  ["review", reviewCommand],
  ["validate", validateCommand],
  ["repair", repairCommand],
  ["apply", applyCommand],
  ["patch-font", patchFontCommand],
  ["run", runCommand]
]);

export async function runCli(argv: string[], io: CliIO = defaultIO): Promise<number> {
  const [command, ...args] = argv;

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
