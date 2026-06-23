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
import type { CharacterGender, CharacterGlossary, CharacterKind } from "../core/types.js";

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

  if (!isCharacterGlossary(parsed)) {
    throw new Error(
      "Character glossary must be an object whose values may include gender, translation, aliases, description and speechStyle"
    );
  }

  return parsed;
}

function isCharacterGlossary(value: unknown): value is CharacterGlossary {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => {
    if (typeof entry !== "object" || entry == null || Array.isArray(entry)) {
      return false;
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
    return (
      (candidate.gender == null || (typeof candidate.gender === "string" && GENDERS.includes(candidate.gender as CharacterGender))) &&
      (candidate.type == null || (typeof candidate.type === "string" && KINDS.includes(candidate.type as CharacterKind))) &&
      (candidate.translation == null || typeof candidate.translation === "string") &&
      (candidate.description == null || typeof candidate.description === "string") &&
      (candidate.speechStyle == null || typeof candidate.speechStyle === "string") &&
      (candidate.confidence == null || typeof candidate.confidence === "number") &&
      (candidate.review == null || typeof candidate.review === "boolean") &&
      (candidate.aliases == null ||
        (Array.isArray(candidate.aliases) && candidate.aliases.every((alias) => typeof alias === "string")))
    );
  });
}
