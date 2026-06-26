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
import type { CharacterGender, CharacterGlossary, CharacterKind } from "../core/types/public-api.js";

const GENDERS: CharacterGender[] = ["male", "female", "neutral", "unknown"];
const KINDS: CharacterKind[] = ["person", "place", "group", "creature", "object", "unknown"];

export async function loadCharacterGlossary(filePath: string): Promise<CharacterGlossary> {
  const raw = await readFile(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    throw new Error(`Invalid character glossary JSON in '${filePath}': ${error instanceof Error ? error.message : String(error)}`, {
      cause: error
    });
  }

  if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) {
    throw new Error(`Character glossary in '${filePath}' must be a JSON object mapping a name to its attributes.`);
  }

  // Validate each entry so a malformed character points at the offending name and
  // field instead of one generic message for the whole file.
  for (const [name, entry] of Object.entries(parsed)) {
    assertValidCharacterEntry(name, entry, filePath);
  }

  return parsed as CharacterGlossary;
}

function assertValidCharacterEntry(name: string, entry: unknown, filePath: string): void {
  const where = `character '${name}' in '${filePath}'`;
  if (typeof entry !== "object" || entry == null || Array.isArray(entry)) {
    throw new Error(`Invalid ${where}: expected an object, got ${describeJsonType(entry)}.`);
  }
  const candidate = entry as {
    gender?: unknown;
    translation?: unknown;
    aliases?: unknown;
    description?: unknown;
    speechStyle?: unknown;
    type?: unknown;
    confidence?: unknown;
    review?: unknown;
  };
  if (candidate.gender != null && !(typeof candidate.gender === "string" && GENDERS.includes(candidate.gender as CharacterGender))) {
    throw new Error(`Invalid ${where}: 'gender' must be one of ${GENDERS.join(", ")}, got ${describeJsonType(candidate.gender)}.`);
  }
  if (candidate.type != null && !(typeof candidate.type === "string" && KINDS.includes(candidate.type as CharacterKind))) {
    throw new Error(`Invalid ${where}: 'type' must be one of ${KINDS.join(", ")}, got ${describeJsonType(candidate.type)}.`);
  }
  for (const field of ["translation", "description", "speechStyle"] as const) {
    if (candidate[field] != null && typeof candidate[field] !== "string") {
      throw new Error(`Invalid ${where}: '${field}' must be a string, got ${describeJsonType(candidate[field])}.`);
    }
  }
  if (candidate.confidence != null && typeof candidate.confidence !== "number") {
    throw new Error(`Invalid ${where}: 'confidence' must be a number, got ${describeJsonType(candidate.confidence)}.`);
  }
  if (candidate.review != null && typeof candidate.review !== "boolean") {
    throw new Error(`Invalid ${where}: 'review' must be a boolean, got ${describeJsonType(candidate.review)}.`);
  }
  if (
    candidate.aliases != null &&
    !(Array.isArray(candidate.aliases) && candidate.aliases.every((alias) => typeof alias === "string"))
  ) {
    throw new Error(`Invalid ${where}: 'aliases' must be an array of strings.`);
  }
}

function describeJsonType(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "nothing";
  }
  return Array.isArray(value) ? "array" : typeof value;
}
