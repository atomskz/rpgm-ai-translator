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

import type { TranslationUnit } from "../../../core/types/types.js";
import {
  decodeEncodedJsonSegment,
  getJsonPathSegments,
  parseJsonPath,
  setJsonPathSegments
} from "../../../core/utils/json-path.js";

// The current value stored in the game file decoded back to the plain source
// string, or undefined when the leaf is not the unit's source (a mismatch). This
// is the gate that keeps a patch from overwriting an already-changed or wrong leaf.
export function currentSourceValue(currentValue: unknown, unit: TranslationUnit): string | undefined {
  if (unit.constraints?.sourceEncoding === "json-string-literal") {
    // Compare by decoded value, not byte-for-byte: a valid but non-canonical
    // literal in the file (escaped solidus `\/`, `\uXXXX`) decodes to the same
    // string and must still match, where JSON.stringify(source) would not.
    return typeof currentValue === "string" && decodeJsonStringLiteral(currentValue) === unit.source
      ? unit.source
      : undefined;
  }

  if (unit.constraints?.sourceEncoding === "json-stringified-json") {
    const segments = encodedJsonSegments(unit);
    if (typeof currentValue !== "string" || !segments) {
      return undefined;
    }
    const parsed = parseEncodedJson(currentValue);
    const nestedValue = parsed == null ? undefined : getJsonPathSegments(parsed, segments);
    return typeof nestedValue === "string" ? nestedValue : undefined;
  }

  return typeof currentValue === "string" ? currentValue : undefined;
}

// Encode a translated string back into the on-disk form the leaf uses (a JSON
// string literal, a value nested in stringified JSON, or a plain string).
export function encodeTranslation(unit: TranslationUnit, currentValue: unknown, translation: string): string {
  if (unit.constraints?.sourceEncoding === "json-string-literal") {
    return JSON.stringify(translation);
  }

  if (unit.constraints?.sourceEncoding === "json-stringified-json") {
    const segments = encodedJsonSegments(unit);
    if (typeof currentValue !== "string" || !segments) {
      throw new Error(`Cannot encode JSON-stringified translation for '${unit.id}'`);
    }
    const parsed = parseEncodedJson(currentValue);
    if (parsed == null) {
      throw new Error(`Invalid JSON-stringified source for '${unit.id}'`);
    }
    setJsonPathSegments(parsed, segments, translation);
    return JSON.stringify(parsed);
  }

  return translation;
}

// Prefer the explicit segments (dot-safe); fall back to splitting the legacy
// dotted path for units read from older units.json files. Segments are decoded
// from their stored form (array-index "#0" marker, escaped "#") to the raw
// property key used for traversal; a string subscript indexes an array too.
function encodedJsonSegments(unit: TranslationUnit): string[] | undefined {
  const stored =
    unit.constraints?.encodedJsonSegments ??
    (unit.constraints?.encodedJsonPath ? parseJsonPath(unit.constraints.encodedJsonPath) : undefined);
  return stored?.map(decodeEncodedJsonSegment);
}

// Decode a JSON string literal (the quoted form stored in a data file) to its
// string value, or undefined when it is not a valid string literal.
function decodeJsonStringLiteral(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseEncodedJson(raw: string): unknown | undefined {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}
