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

import type { TranslationUnit } from "../../../core/types/public-api.js";
import {
  isSafeTranslatablePluginParameter,
  parsePluginsJs,
  pluginParameterPath
} from "../plugins-file.js";
import { extractEncodedJsonStrings } from "./encoded-json.js";
import {
  type DraftBase,
  type JsonObject,
  type UnitDraft,
  isSafeRuntimeText,
  isTranslatableString,
  makeDraft
} from "./shared.js";

export function extractPluginCommandText(
  args: JsonObject,
  options: DraftBase & {
    prefix: string;
    context?: TranslationUnit["context"];
  }
): UnitDraft[] {
  const units: UnitDraft[] = [];
  const safeTextKeys = new Set(["messageText", "helpText", "description", "displayText"]);

  for (const [key, value] of Object.entries(args)) {
    if (safeTextKeys.has(key) && isTranslatableString(value) && isSafeRuntimeText(value)) {
      units.push(
        makeDraft(options, `${options.prefix}.${key}`, value, "system", options.context, {
          maxLines: 1,
          maxLength: 48
        })
      );
      continue;
    }

    if (typeof value === "string") {
      units.push(
        ...extractEncodedJsonStrings(value, `${options.prefix}.${key}`, options, "system", {
          maxLines: 1,
          maxLength: 48
        })
      );
    }
  }

  return units;
}

export function extractPluginsJs(raw: string, base: DraftBase): UnitDraft[] {
  const plugins = parsePluginsJs(raw);
  const units: UnitDraft[] = [];

  plugins.forEach((plugin, pluginIndex) => {
    if (!plugin?.status || !plugin.parameters) {
      return;
    }

    for (const [key, source] of Object.entries(plugin.parameters)) {
      if (typeof source === "string" && isSafeTranslatablePluginParameter(key, source)) {
        units.push(
          makeDraft(
            base,
            pluginParameterPath(pluginIndex, key),
            source,
            "plugin-parameter",
            { eventName: plugin.name }
          )
        );
        continue;
      }

      if (typeof source === "string") {
        units.push(
          ...extractEncodedJsonStrings(
            source,
            pluginParameterPath(pluginIndex, key),
            {
              ...base,
              context: { eventName: plugin.name }
            },
            "plugin-parameter",
            { maxLines: 1, maxLength: 48 }
          )
        );
      }
    }
  });

  return units;
}
