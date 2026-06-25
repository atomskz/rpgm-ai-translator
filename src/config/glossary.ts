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

  if (!isGlossary(parsed)) {
    throw new Error("Glossary must be an object whose values have a valid mode and optional translation string");
  }

  // A `custom` term is defined as "use the provided translation exactly", so an
  // entry in that mode without a translation is a contradictory instruction. Reject
  // it before any provider call rather than sending the model an empty pin.
  for (const [term, entry] of Object.entries(parsed)) {
    if (entry.mode === "custom" && (entry.translation == null || entry.translation.trim() === "")) {
      throw new Error(
        `Glossary term '${term}' uses mode 'custom' but has no translation; custom mode requires the exact translation to use (or pick mode 'keep' or 'transliterate').`
      );
    }
  }

  return parsed;
}

function isGlossary(value: unknown): value is Glossary {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => {
    if (typeof entry !== "object" || entry == null || Array.isArray(entry)) {
      return false;
    }
    const candidate = entry as { mode?: unknown; translation?: unknown };
    return (
      typeof candidate.mode === "string" &&
      MODES.includes(candidate.mode as GlossaryMode) &&
      (candidate.translation == null || typeof candidate.translation === "string")
    );
  });
}
