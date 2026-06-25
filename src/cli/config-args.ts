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

import { CONFIG_FIELD_SPECS, type ProjectConfig } from "../config/public-api.js";
import { COMMAND_OPTION_SPECS } from "./options/public-api.js";

// Inject config-provided defaults into argv for the given command. Only flags
// the command actually accepts are added, and only when not already present, so
// an explicit CLI flag always wins over config. This bridges loaded config to
// the CLI's argv format, so it lives in the CLI layer rather than in config.
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
