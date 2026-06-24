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

import type { TranslationCategory, TranslationUnit } from "../../types.js";
import { encodeArrayIndexSegment, encodeObjectKeySegment } from "../../utils/json-path.js";
import {
  type DraftBase,
  type UnitDraft,
  isObject,
  isSafeRuntimeText,
  makeDraft
} from "./shared.js";

export function extractEncodedJsonStrings(
  raw: string,
  outerJsonPath: string,
  base: DraftBase & {
    context?: TranslationUnit["context"];
  },
  category: TranslationCategory,
  constraints: TranslationUnit["constraints"]
): UnitDraft[] {
  const parsed = parseJsonString(raw);
  if (parsed == null) {
    return [];
  }

  const units: UnitDraft[] = [];
  visitEncodedJsonStrings(parsed, [], (segments, key, source) => {
    if (!isSafeEncodedJsonTextKey(key) || !isSafeRuntimeText(source)) {
      return;
    }
    units.push(
      makeDraft(base, outerJsonPath, source, category, base.context, {
        ...constraints,
        sourceEncoding: "json-stringified-json",
        encodedJsonPath: segments.join("."),
        encodedJsonSegments: segments
      })
    );
  });
  return units;
}

function visitEncodedJsonStrings(
  value: unknown,
  pathSegments: string[],
  visit: (segments: string[], key: string, value: string) => void
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      visitEncodedJsonStrings(item, [...pathSegments, encodeArrayIndexSegment(index)], visit)
    );
    return;
  }

  if (!isObject(value)) {
    return;
  }

  for (const [key, item] of Object.entries(value)) {
    const segments = [...pathSegments, encodeObjectKeySegment(key)];
    if (typeof item === "string") {
      visit(segments, key, item);
    } else {
      visitEncodedJsonStrings(item, segments, visit);
    }
  }
}

function parseJsonString(raw: string): unknown | undefined {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function isSafeEncodedJsonTextKey(key: string): boolean {
  return /^(?:text|label|messageText|helpText|description|displayText|caption|title|commandName|itemName|optionName)$/i.test(key);
}
