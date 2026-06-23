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

import { readFile } from "node:fs/promises";
import path from "node:path";
import { COMMAND_OPTION_SPECS } from "../cli/options.js";

// Default config file name looked up in the working directory when --config is
// not given. Absent file is not an error; an explicit --config that is missing
// or malformed is.
export const PROJECT_CONFIG_FILENAME = "rpgm-ai-translator.json";

// Persistent project config so a long run does not need ~15 flags every time.
// Every field maps to an existing CLI flag; precedence is CLI flag > config >
// built-in default, achieved by injecting config values as defaults into the
// argv only where the flag is not already present (see mergeConfigIntoArgs).
export type ProjectConfig = {
  provider?: string;
  baseUrl?: string;
  model?: string;
  target?: string;
  batchSize?: number;
  timeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
  maxTokensBudget?: number;
  retryAttempts?: number;
  out?: string;
  workDir?: string;
  memory?: string;
  glossary?: string;
  characters?: string;
  repairAttempts?: number;
  repairCodes?: string | string[];
  font?: string;
  numberFont?: string;
  mode?: string;
  backup?: string;
  includeComments?: boolean;
  includePlugins?: boolean;
  includeSpeakerNames?: boolean;
  review?: boolean;
  repair?: boolean;
};

type ConfigFieldSpec =
  | { key: keyof ProjectConfig; flag: string; kind: "value" }
  | { key: keyof ProjectConfig; flag: string; kind: "boolean" };

// Single source of truth for the config-key -> CLI-flag mapping. Value fields
// inject `--flag <value>`; boolean fields inject `--flag` only when true (there
// is no `--no-*` form, so config can enable a flag but cannot force it off).
const CONFIG_FIELD_SPECS: readonly ConfigFieldSpec[] = [
  { key: "provider", flag: "--provider", kind: "value" },
  { key: "baseUrl", flag: "--base-url", kind: "value" },
  { key: "model", flag: "--model", kind: "value" },
  { key: "target", flag: "--target", kind: "value" },
  { key: "batchSize", flag: "--batch-size", kind: "value" },
  { key: "timeoutMs", flag: "--timeout-ms", kind: "value" },
  { key: "temperature", flag: "--temperature", kind: "value" },
  { key: "maxTokens", flag: "--max-tokens", kind: "value" },
  { key: "maxTokensBudget", flag: "--max-tokens-budget", kind: "value" },
  { key: "retryAttempts", flag: "--retry-attempts", kind: "value" },
  { key: "out", flag: "--out", kind: "value" },
  { key: "workDir", flag: "--work-dir", kind: "value" },
  { key: "memory", flag: "--memory", kind: "value" },
  { key: "glossary", flag: "--glossary", kind: "value" },
  { key: "characters", flag: "--characters", kind: "value" },
  { key: "repairAttempts", flag: "--repair-attempts", kind: "value" },
  { key: "repairCodes", flag: "--repair-codes", kind: "value" },
  { key: "font", flag: "--font", kind: "value" },
  { key: "numberFont", flag: "--number-font", kind: "value" },
  { key: "mode", flag: "--mode", kind: "value" },
  { key: "backup", flag: "--backup", kind: "value" },
  { key: "includeComments", flag: "--include-comments", kind: "boolean" },
  { key: "includePlugins", flag: "--include-plugins", kind: "boolean" },
  { key: "includeSpeakerNames", flag: "--include-speaker-names", kind: "boolean" },
  { key: "review", flag: "--review", kind: "boolean" },
  { key: "repair", flag: "--repair", kind: "boolean" }
];

// --config is accepted by every command; it is consumed before dispatch and
// must not be treated as an unknown option by validateCommandArgs.
export const CONFIG_FLAG = "--config";

export async function loadProjectConfig(
  cwd: string,
  configPath: string | undefined
): Promise<ProjectConfig | undefined> {
  if (configPath != null) {
    return parseProjectConfig(await readConfigFile(configPath, true), configPath);
  }
  const defaultPath = path.join(cwd, PROJECT_CONFIG_FILENAME);
  const raw = await readConfigFile(defaultPath, false);
  return raw == null ? undefined : parseProjectConfig(raw, defaultPath);
}

async function readConfigFile(filePath: string, required: true): Promise<string>;
async function readConfigFile(filePath: string, required: false): Promise<string | undefined>;
async function readConfigFile(filePath: string, required: boolean): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error: unknown) {
    if (!required && (error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return undefined;
    }
    throw new Error(`Cannot read config file '${filePath}': ${error instanceof Error ? error.message : String(error)}`, {
      cause: error
    });
  }
}

function parseProjectConfig(raw: string, filePath: string): ProjectConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    throw new Error(`Invalid config JSON in '${filePath}': ${error instanceof Error ? error.message : String(error)}`, {
      cause: error
    });
  }
  if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) {
    throw new Error(`Config in '${filePath}' must be a JSON object`);
  }
  return parsed as ProjectConfig;
}

// Inject config-provided defaults into argv for the given command. Only flags
// the command actually accepts are added, and only when not already present, so
// an explicit CLI flag always wins over config.
export function mergeConfigIntoArgs(command: string, args: string[], config: ProjectConfig | undefined): string[] {
  if (!config) {
    return args;
  }
  const spec = COMMAND_OPTION_SPECS[command];
  if (!spec) {
    return args;
  }
  const valueOptions = new Set<string>(spec.valueOptions);
  const booleanFlags = new Set<string>(spec.booleanFlags);
  const present = new Set(args.filter((token) => token.startsWith("--")));
  const injected: string[] = [];

  for (const field of CONFIG_FIELD_SPECS) {
    const value = config[field.key];
    if (value == null || present.has(field.flag)) {
      continue;
    }
    if (field.kind === "boolean") {
      if (value === true && booleanFlags.has(field.flag)) {
        injected.push(field.flag);
      }
      continue;
    }
    if (!valueOptions.has(field.flag)) {
      continue;
    }
    injected.push(field.flag, formatValue(value));
  }

  return injected.length > 0 ? [...args, ...injected] : args;
}

function formatValue(value: ProjectConfig[keyof ProjectConfig]): string {
  if (Array.isArray(value)) {
    return value.join(",");
  }
  return String(value);
}
