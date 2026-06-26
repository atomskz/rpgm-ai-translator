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
import type { Glossary, GlossaryMode } from "../core/types/public-api.js";

const MODES: GlossaryMode[] = ["keep", "translate", "transliterate", "custom"];

export async function loadGlossary(filePath: string): Promise<Glossary> {
  const raw = await readFile(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    throw new Error(`Invalid glossary JSON in '${filePath}': ${error instanceof Error ? error.message : String(error)}`, {
      cause: error
    });
  }

  if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) {
    throw new Error(`Glossary in '${filePath}' must be a JSON object mapping a term to { mode, translation? }.`);
  }

  // Validate each entry so a malformed term points at the offending key (and the
  // specific problem) instead of one generic message for the whole file.
  for (const [term, entry] of Object.entries(parsed)) {
    assertValidGlossaryEntry(term, entry, filePath);
  }

  return parsed as Glossary;
}

function assertValidGlossaryEntry(term: string, entry: unknown, filePath: string): void {
  const where = `glossary term '${term}' in '${filePath}'`;
  if (typeof entry !== "object" || entry == null || Array.isArray(entry)) {
    throw new Error(`Invalid ${where}: expected an object with a 'mode', got ${describeJsonType(entry)}.`);
  }
  const candidate = entry as { mode?: unknown; translation?: unknown };
  if (typeof candidate.mode !== "string" || !MODES.includes(candidate.mode as GlossaryMode)) {
    throw new Error(`Invalid ${where}: 'mode' must be one of ${MODES.join(", ")}, got ${describeJsonType(candidate.mode)}.`);
  }
  if (candidate.translation != null && typeof candidate.translation !== "string") {
    throw new Error(`Invalid ${where}: 'translation' must be a string, got ${describeJsonType(candidate.translation)}.`);
  }
  // A `custom` term is defined as "use the provided translation exactly", so an
  // entry in that mode without a translation is a contradictory instruction.
  if (candidate.mode === "custom" && (candidate.translation == null || candidate.translation.trim() === "")) {
    throw new Error(
      `Glossary term '${term}' in '${filePath}' uses mode 'custom' but has no translation; custom mode requires the exact translation to use (or pick mode 'keep' or 'transliterate').`
    );
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
