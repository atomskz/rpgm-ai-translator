import type { TranslationUnit } from "../../types.js";
import {
  isSafeTranslatablePluginParameter,
  parsePluginsJs,
  pluginParameterPath
} from "../../plugins/index.js";
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
