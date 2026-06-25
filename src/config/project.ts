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
import { COMMAND_OPTION_SPECS } from "../cli/options/public-api.js";
import { isValidationIssueCode } from "../core/validators/public-api.js";

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
  dialogueMaxLength?: number;
  includeComments?: boolean;
  includePlugins?: boolean;
  includeSpeakerNames?: boolean;
  review?: boolean;
  repair?: boolean;
};

// Expected JSON type of a config value, used both to validate the parsed file
// and to decide how the value is injected into argv. "codes" is a string or
// string[] of validation issue codes (the only multi-shape field).
type ConfigFieldType = "string" | "number" | "boolean" | "codes";

type ConfigFieldSpec = { key: keyof ProjectConfig; flag: string; type: ConfigFieldType };

// Single source of truth for the config-key -> CLI-flag mapping. Non-boolean
// fields inject `--flag <value>`; boolean fields inject `--flag` only when true
// (there is no `--no-*` form, so config can enable a flag but cannot force it
// off). `type` is also the per-field validation contract for the parsed file.
const CONFIG_FIELD_SPECS: readonly ConfigFieldSpec[] = [
  { key: "provider", flag: "--provider", type: "string" },
  { key: "baseUrl", flag: "--base-url", type: "string" },
  { key: "model", flag: "--model", type: "string" },
  { key: "target", flag: "--target", type: "string" },
  { key: "batchSize", flag: "--batch-size", type: "number" },
  { key: "timeoutMs", flag: "--timeout-ms", type: "number" },
  { key: "temperature", flag: "--temperature", type: "number" },
  { key: "maxTokens", flag: "--max-tokens", type: "number" },
  { key: "maxTokensBudget", flag: "--max-tokens-budget", type: "number" },
  { key: "retryAttempts", flag: "--retry-attempts", type: "number" },
  { key: "out", flag: "--out", type: "string" },
  { key: "workDir", flag: "--work-dir", type: "string" },
  { key: "memory", flag: "--memory", type: "string" },
  { key: "glossary", flag: "--glossary", type: "string" },
  { key: "characters", flag: "--characters", type: "string" },
  { key: "repairAttempts", flag: "--repair-attempts", type: "number" },
  { key: "repairCodes", flag: "--repair-codes", type: "codes" },
  { key: "font", flag: "--font", type: "string" },
  { key: "numberFont", flag: "--number-font", type: "string" },
  { key: "mode", flag: "--mode", type: "string" },
  { key: "backup", flag: "--backup", type: "string" },
  { key: "dialogueMaxLength", flag: "--dialogue-max-length", type: "number" },
  { key: "includeComments", flag: "--include-comments", type: "boolean" },
  { key: "includePlugins", flag: "--include-plugins", type: "boolean" },
  { key: "includeSpeakerNames", flag: "--include-speaker-names", type: "boolean" },
  { key: "review", flag: "--review", type: "boolean" },
  { key: "repair", flag: "--repair", type: "boolean" }
];

const CONFIG_FIELD_BY_KEY = new Map<string, ConfigFieldSpec>(
  CONFIG_FIELD_SPECS.map((spec) => [spec.key, spec])
);

// --config is accepted by every command; it is consumed before dispatch and
// must not be treated as an unknown option by validateCommandArgs.
export const CONFIG_FLAG = "--config";

export async function loadProjectConfig(
  cwd: string,
  configPath: string | undefined,
  onWarning: (message: string) => void = () => {}
): Promise<ProjectConfig | undefined> {
  if (configPath != null) {
    return parseProjectConfig(await readConfigFile(configPath, true), configPath, onWarning);
  }
  const defaultPath = path.join(cwd, PROJECT_CONFIG_FILENAME);
  const raw = await readConfigFile(defaultPath, false);
  return raw == null ? undefined : parseProjectConfig(raw, defaultPath, onWarning);
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

function parseProjectConfig(raw: string, filePath: string, onWarning: (message: string) => void): ProjectConfig {
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
  // Validate each field against its declared type so a wrong value points at the
  // config (file + key) rather than surfacing later as an opaque flag error.
  // Unknown keys are a likely typo (`temprature`), so warn but do not fail.
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const spec = CONFIG_FIELD_BY_KEY.get(key);
    if (!spec) {
      onWarning(`Unknown config key '${key}' in '${filePath}' (ignored).`);
      continue;
    }
    if (value == null) {
      continue;
    }
    validateConfigField(spec, value, filePath);
  }
  return parsed as ProjectConfig;
}

function validateConfigField(spec: ConfigFieldSpec, value: unknown, filePath: string): void {
  const location = `config key '${spec.key}' in '${filePath}'`;
  switch (spec.type) {
    case "string":
      if (typeof value !== "string") {
        throw new Error(`Invalid ${location}: expected a string, got ${describeJsonType(value)}.`);
      }
      return;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`Invalid ${location}: expected a finite number, got ${describeJsonType(value)}.`);
      }
      return;
    case "boolean":
      if (typeof value !== "boolean") {
        throw new Error(`Invalid ${location}: expected a boolean, got ${describeJsonType(value)}.`);
      }
      return;
    case "codes":
      validateRepairCodes(value, location);
      return;
  }
}

function validateRepairCodes(value: unknown, location: string): void {
  const codes = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : null;
  if (codes == null) {
    throw new Error(`Invalid ${location}: expected a string or an array of strings, got ${describeJsonType(value)}.`);
  }
  for (const code of codes) {
    if (typeof code !== "string") {
      throw new Error(`Invalid ${location}: expected only strings, got ${describeJsonType(code)}.`);
    }
    const trimmed = code.trim();
    if (trimmed.length > 0 && !isValidationIssueCode(trimmed)) {
      throw new Error(`Invalid ${location}: unknown validation issue code '${trimmed}'.`);
    }
  }
}

function describeJsonType(value: unknown): string {
  if (value === null) {
    return "null";
  }
  return Array.isArray(value) ? "array" : typeof value;
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
    if (field.type === "boolean") {
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
