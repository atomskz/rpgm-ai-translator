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

import path from "node:path";
import type { EngineId, TranslationCategory, TranslationUnit } from "../../../core/types/public-api.js";
import { protectPlaceholders } from "../../../core/placeholders.js";
import { hashSource } from "../../../core/utils/hash.js";
import { containsTranslatableLetter } from "../../../core/utils/text.js";

export type JsonObject = Record<string, unknown>;

export type UnitDraft = {
  source: string;
  absoluteFilePath: string;
  relativeFilePath: string;
  jsonPath: string;
  engine: EngineId;
  category: TranslationCategory;
  context?: TranslationUnit["context"];
  constraints?: TranslationUnit["constraints"];
};

export type DraftBase = Pick<UnitDraft, "absoluteFilePath" | "relativeFilePath" | "engine">;

export function makeDraft(
  base: DraftBase,
  jsonPath: string,
  source: string,
  category: TranslationCategory,
  context?: TranslationUnit["context"],
  constraints: TranslationUnit["constraints"] = {}
): UnitDraft {
  return {
    ...base,
    source,
    jsonPath,
    category,
    context,
    constraints: {
      preserveControlCodes: true,
      preserveNewlines: source.includes("\n"),
      maxLines: source.includes("\n") ? source.split(/\r?\n/).length : constraints.maxLines,
      ...constraints
    }
  };
}

export function toTranslationUnit(draft: UnitDraft): TranslationUnit {
  const protectedText = protectPlaceholders(draft.source);
  return {
    id: `${path.basename(draft.relativeFilePath, path.extname(draft.relativeFilePath))}.${draft.jsonPath}${encodedJsonIdSuffix(draft.constraints)}`,
    source: draft.source,
    normalizedSource: protectedText.text,
    filePath: draft.relativeFilePath,
    jsonPath: draft.jsonPath,
    engine: draft.engine,
    category: draft.category,
    context: draft.context,
    constraints: draft.constraints,
    placeholders: protectedText.placeholders,
    hash: hashSource(draft.source)
  };
}

// Suffix that disambiguates a value living inside a stringified-JSON parameter.
// Segments are joined with `.`, so a literal `.` (or the escape char) inside an
// object key is escaped JSON-Pointer style (`~` -> `~0`, `.` -> `~1`); otherwise
// `["a.b","text"]` and `["a","b","text"]` would collapse to the same id and
// silently drop or cross-wire one of the two translations. Keys without a `.`
// (the common case) are unchanged, keeping ids stable.
function encodedJsonIdSuffix(constraints: TranslationUnit["constraints"]): string {
  if (constraints?.sourceEncoding !== "json-stringified-json") {
    return "";
  }
  const segments = constraints.encodedJsonSegments;
  if (segments) {
    return `.$json.${segments.map(encodeIdSegment).join(".")}`;
  }
  return constraints.encodedJsonPath ? `.$json.${constraints.encodedJsonPath}` : "";
}

function encodeIdSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\./g, "~1");
}

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

export function isTranslatableString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function decodeScriptStringLiteral(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function isSafeRuntimeText(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (/^\$game[A-Za-z]+\./.test(trimmed) || /^(?:true|false|null)$/i.test(trimmed)) {
    return false;
  }
  // Asset reference (an image/audio path), not translatable text. Allow spaces and
  // backslash separators so a path like `img\face 1.png` is recognized and not
  // extracted as a translatable string.
  if (/^[\w./\\ -]+\.(?:png|jpg|jpeg|webp|ogg|m4a|mp3|wav)$/i.test(trimmed)) {
    return false;
  }
  return containsTranslatableLetter(trimmed);
}

export function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
