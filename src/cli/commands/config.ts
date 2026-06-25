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

import { loadProjectConfig, PROJECT_CONFIG_FILENAME } from "../../config/public-api.js";
import { mergeConfigIntoArgs } from "../config-args.js";
import { COMMAND_OPTION_SPECS, readOption, readPositionals, UsageError } from "../options/public-api.js";
import type { CliIO } from "../types.js";

// `config validate|print` surfaces what the project config actually does, so a
// dropped/mistyped key or a path-scoped flag is visible without running a real
// command. It loads the config itself (the dispatcher skips the usual pre-load for
// this command) so it can report a malformed file rather than aborting first.
export async function configCommand(args: string[], io: CliIO): Promise<number> {
  const [subcommand, targetCommand] = readPositionals(args);
  if (subcommand !== "validate" && subcommand !== "print") {
    throw new UsageError("Usage: config validate | config print [command]");
  }
  const configOption = readOption(args, "--config");
  const cwd = process.cwd();

  if (subcommand === "validate") {
    return validateConfig(cwd, configOption, io);
  }
  return printConfig(cwd, configOption, targetCommand, io);
}

async function validateConfig(cwd: string, configOption: string | undefined, io: CliIO): Promise<number> {
  const warnings: string[] = [];
  let config;
  try {
    config = await loadProjectConfig(cwd, configOption, (warning) => warnings.push(warning));
  } catch (error: unknown) {
    // A malformed file or a wrong value type is a hard error: report it and exit
    // non-zero so a CI check fails instead of running with a broken config.
    io.stderr(`Invalid config: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  if (config === undefined) {
    io.stdout(`No config file found (looked for ./${PROJECT_CONFIG_FILENAME}). Run 'init' to create one.\n`);
    return 0;
  }
  for (const warning of warnings) {
    io.stdout(`Warning: ${warning}\n`);
  }
  // Unknown keys are warnings, not errors (a forward-compatible field, or a typo
  // already pointed at a suggestion), so a type-valid config still passes.
  io.stdout(`Config is valid${warnings.length > 0 ? ` with ${warnings.length} warning(s)` : ""}.\n`);
  return 0;
}

async function printConfig(
  cwd: string,
  configOption: string | undefined,
  targetCommand: string | undefined,
  io: CliIO
): Promise<number> {
  const config = await loadProjectConfig(cwd, configOption, (warning) => io.stderr(`Warning: ${warning}\n`));
  if (config === undefined) {
    io.stdout(`No config file found (looked for ./${PROJECT_CONFIG_FILENAME}).\n`);
    return 0;
  }
  if (targetCommand === undefined) {
    io.stdout(`${JSON.stringify(config, null, 2)}\n`);
    return 0;
  }
  if (!COMMAND_OPTION_SPECS[targetCommand]) {
    throw new UsageError(`Unknown command '${targetCommand}'. Pass a command name to see the flags config injects into it.`);
  }
  // Reuse the real injection (so path-scoping and aliases are reflected): with no
  // CLI args, the merged result is exactly the flags config would contribute.
  const injected = mergeConfigIntoArgs(targetCommand, [], config);
  if (injected.length === 0) {
    io.stdout(`No config values apply to '${targetCommand}'.\n`);
    return 0;
  }
  io.stdout(`Effective config flags for '${targetCommand}':\n  ${injected.join(" ")}\n`);
  return 0;
}
