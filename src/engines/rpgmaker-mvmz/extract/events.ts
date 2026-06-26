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

import type { ExtractOptions, TranslationUnit } from "../../../core/types/public-api.js";
import { extractPluginCommandText } from "./plugins.js";

// Default max display width (in cells) for a single Show Text dialogue line,
// used when ExtractOptions.dialogueMaxLength (CLI --dialogue-max-length) is not
// set. Overridable because how many characters fit on a line depends on the
// game's message font.
export const DEFAULT_DIALOGUE_MAX_LENGTH = 52;
import {
  type DraftBase,
  type JsonObject,
  type UnitDraft,
  decodeScriptStringLiteral,
  isObject,
  isSafeRuntimeText,
  isTranslatableString,
  makeDraft,
  numberOrUndefined,
  stringOrUndefined
} from "./shared.js";

export function extractMap(
  data: JsonObject,
  base: DraftBase & {
    extractOptions: ExtractOptions;
  }
): UnitDraft[] {
  const units: UnitDraft[] = [];
  const mapName = stringOrUndefined(data.displayName);

  if (isTranslatableString(data.displayName)) {
    units.push(makeDraft(base, "displayName", data.displayName, "name", { mapName }));
  }

  const events = data.events;
  if (!Array.isArray(events)) {
    return units;
  }

  events.forEach((event, eventIndex) => {
    if (!isObject(event)) {
      return;
    }
    const eventContext = {
      mapName,
      eventId: numberOrUndefined(event.id),
      eventName: stringOrUndefined(event.name)
    };
    const pages = event.pages;
    if (!Array.isArray(pages)) {
      return;
    }
    pages.forEach((page, pageIndex) => {
      if (!isObject(page)) {
        return;
      }
      units.push(
        ...extractEventCommandList(page.list, {
          ...base,
          prefix: `events.${eventIndex}.pages.${pageIndex}.list`,
          context: eventContext,
          includeComments: base.extractOptions.includeEventComments ?? false
        })
      );
    });
  });

  return units;
}

export function extractEventCommandList(
  list: unknown,
  options: DraftBase & {
    prefix: string;
    context?: TranslationUnit["context"];
    includeComments: boolean;
    extractOptions: ExtractOptions;
  }
): UnitDraft[] {
  if (!Array.isArray(list)) {
    return [];
  }

  const units: UnitDraft[] = [];

  let currentSpeaker = options.context?.speaker;

  list.forEach((command, commandIndex) => {
    if (!isObject(command) || !Array.isArray(command.parameters)) {
      return;
    }

    const code = command.code;
    const speakerParameter = command.parameters[4];
    if (code === 101 && isTranslatableString(speakerParameter)) {
      currentSpeaker = speakerParameter;
      if (options.extractOptions.includeSpeakerNames === true) {
        units.push(
          makeDraft(
            options,
            `${options.prefix}.${commandIndex}.parameters.4`,
            speakerParameter,
            "name",
            {
              ...options.context,
              speaker: currentSpeaker,
              ...neighborContext(list, commandIndex)
            },
            { maxLines: 1, maxLength: 24 }
          )
        );
      }
    }

    const textParameter = command.parameters[0];
    // Show Text (401) is a message-window line bounded by the per-line display
    // width. Show Scrolling Text continuation (405, following a 105 header) scrolls
    // vertically with no per-line width limit, so it carries no maxLength — applying
    // the 52-cell dialogue budget to it produced spurious MAX_LENGTH_EXCEEDED.
    if (code === 401 && isTranslatableString(textParameter)) {
      units.push(
        makeDraft(
          options,
          `${options.prefix}.${commandIndex}.parameters.0`,
          textParameter,
          "dialogue",
          {
            ...options.context,
            speaker: currentSpeaker,
            ...neighborContext(list, commandIndex)
          },
          { maxLines: 1, maxLength: options.extractOptions.dialogueMaxLength ?? DEFAULT_DIALOGUE_MAX_LENGTH }
        )
      );
    }
    if (code === 405 && isTranslatableString(textParameter)) {
      units.push(
        makeDraft(
          options,
          `${options.prefix}.${commandIndex}.parameters.0`,
          textParameter,
          "dialogue",
          {
            ...options.context,
            speaker: currentSpeaker,
            ...neighborContext(list, commandIndex)
          }
        )
      );
    }

    if (code === 102 && Array.isArray(textParameter)) {
      textParameter.forEach((choice, choiceIndex) => {
        if (isTranslatableString(choice)) {
          units.push(
            makeDraft(
              options,
              `${options.prefix}.${commandIndex}.parameters.0.${choiceIndex}`,
              choice,
              "choice",
              {
                ...options.context,
                ...neighborContext(list, commandIndex)
              },
              { maxLines: 1, maxLength: 28 }
            )
          );
        }
      });
    }

    const variableScriptValue = command.parameters[4];
    if (code === 122 && command.parameters[3] === 4 && typeof variableScriptValue === "string") {
      const source = decodeScriptStringLiteral(variableScriptValue);
      if (isTranslatableString(source)) {
        units.push(
          makeDraft(
            options,
            `${options.prefix}.${commandIndex}.parameters.4`,
            source,
            "system",
            {
              ...options.context,
              speaker: currentSpeaker,
              ...neighborContext(list, commandIndex)
            },
            { maxLines: 1, maxLength: 54, sourceEncoding: "json-string-literal" }
          )
        );
      }
    }

    // Change Name (320), Change Nickname (324) and Change Profile (325) set actor
    // display text to a literal string at parameters[1].
    const actorTextParameter = command.parameters[1];
    if ((code === 320 || code === 324 || code === 325) && isTranslatableString(actorTextParameter)) {
      units.push(
        makeDraft(
          options,
          `${options.prefix}.${commandIndex}.parameters.1`,
          actorTextParameter,
          code === 325 ? "description" : "name",
          {
            ...options.context,
            speaker: currentSpeaker,
            ...neighborContext(list, commandIndex)
          }
        )
      );
    }

    // MV-style Plugin Command (356) carries a single free-text command line at
    // parameters[0]. It is often code rather than display text, so it is only
    // extracted with --include-plugins and the runtime-text safety filter, and
    // should be reviewed before applying. (402 "When [choice]" / 403 "When
    // Cancel" are intentionally not extracted because their labels duplicate the
    // Show Choices (102) list.)
    const mvPluginCommand = command.parameters[0];
    if (
      code === 356 &&
      options.extractOptions.includePlugins === true &&
      isTranslatableString(mvPluginCommand) &&
      isSafeRuntimeText(mvPluginCommand)
    ) {
      units.push(
        makeDraft(
          options,
          `${options.prefix}.${commandIndex}.parameters.0`,
          mvPluginCommand,
          "plugin-parameter",
          {
            ...options.context,
            speaker: currentSpeaker,
            ...neighborContext(list, commandIndex)
          }
        )
      );
    }

    const pluginCommandArgs = command.parameters[3];
    if (code === 357 && isObject(pluginCommandArgs)) {
      units.push(
        ...extractPluginCommandText(pluginCommandArgs, {
          ...options,
          prefix: `${options.prefix}.${commandIndex}.parameters.3`,
          context: {
            ...options.context,
            speaker: currentSpeaker,
            ...neighborContext(list, commandIndex)
          }
        })
      );
    }

    if (options.includeComments && (code === 108 || code === 408) && isTranslatableString(textParameter)) {
      units.push(
        makeDraft(options, `${options.prefix}.${commandIndex}.parameters.0`, textParameter, "unknown", {
          ...options.context,
          ...neighborContext(list, commandIndex)
        })
      );
    }
  });

  return units;
}

function neighborContext(list: unknown[], commandIndex: number): Pick<NonNullable<TranslationUnit["context"]>, "previousLines" | "nextLines"> {
  return {
    previousLines: collectNeighborLines(list, commandIndex, -1),
    nextLines: collectNeighborLines(list, commandIndex, 1)
  };
}

function collectNeighborLines(list: unknown[], commandIndex: number, direction: -1 | 1, limit = 2): string[] {
  const lines: string[] = [];
  for (let index = commandIndex + direction; index >= 0 && index < list.length && lines.length < limit; index += direction) {
    const text = eventCommandText(list[index]);
    if (text) {
      lines.push(text);
    }
  }
  return direction === -1 ? lines.reverse() : lines;
}

function eventCommandText(command: unknown): string | undefined {
  if (!isObject(command) || !Array.isArray(command.parameters)) {
    return undefined;
  }

  const code = command.code;
  const firstParameter = command.parameters[0];
  if ((code === 401 || code === 405 || code === 108 || code === 408) && isTranslatableString(firstParameter)) {
    return firstParameter;
  }

  if (code === 102 && Array.isArray(firstParameter)) {
    return firstParameter.filter(isTranslatableString).join(" / ") || undefined;
  }

  const variableScriptValue = command.parameters[4];
  if (code === 122 && command.parameters[3] === 4 && typeof variableScriptValue === "string") {
    return decodeScriptStringLiteral(variableScriptValue);
  }

  const pluginCommandArgs = command.parameters[3];
  if (code === 357 && isObject(pluginCommandArgs) && isTranslatableString(pluginCommandArgs.messageText)) {
    return pluginCommandArgs.messageText;
  }

  return undefined;
}
