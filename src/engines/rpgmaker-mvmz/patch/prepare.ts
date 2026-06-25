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

import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type { TranslationResult, TranslationUnit } from "../../../core/types/types.js";
import { restorePlaceholders } from "../../../core/placeholders.js";
import { detectJsonStyle, type JsonStyle } from "../../../core/utils/fs.js";
import { getJsonPath, setJsonPath } from "../../../core/utils/json-path.js";
import { getPluginParameter, parsePluginsJs, replacePluginsArray, setPluginParameter } from "../plugins-file.js";
import { currentSourceValue, encodeTranslation } from "./encoding.js";
import { assertSafeRelativePath, isInsideDirectory } from "./paths.js";

export type PreparedFile = {
  relativeFilePath: string;
  sourcePath: string;
  content: unknown;
  format: "json" | "text";
  style?: JsonStyle;
  unitsApplied: number;
  skipped: number;
};

export type PreparedFileSet = {
  files: PreparedFile[];
  skipped: number;
  skippedUnmatched: number;
};

type FileEntry = { unit: TranslationUnit; result: TranslationResult };

// Group translations by their target file, validate the path is inside the
// project, and turn each file into a PreparedFile with the translations applied in
// memory (nothing is written here). Skips are categorized: an id/source mismatch
// (`skippedUnmatched`) versus a translation that was simply not produced.
export async function prepareFiles(
  root: string,
  units: TranslationUnit[],
  translations: TranslationResult[],
  onWarning?: (message: string) => void
): Promise<PreparedFileSet> {
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  const translatedByFile = new Map<string, FileEntry[]>();
  let skipped = 0;
  // Subset of `skipped` caused by an id/source mismatch with the game data, kept
  // apart from translations that were simply not produced so a caller can warn on a
  // genuine flag/extraction mismatch without counting unfinished translations.
  let skippedUnmatched = 0;

  for (const result of translations) {
    const unit = unitsById.get(result.id);
    if (!unit) {
      // The translation's id is not among the units (e.g. re-extracted with
      // different flags) — a real id mismatch.
      skipped += 1;
      skippedUnmatched += 1;
      continue;
    }
    if (result.status !== "translated" || result.translation.trim().length === 0) {
      // Produced no usable translation; not an id mismatch.
      skipped += 1;
      continue;
    }

    const bucket = translatedByFile.get(unit.filePath) ?? [];
    bucket.push({ unit, result });
    translatedByFile.set(unit.filePath, bucket);
  }

  const realRoot = await realpath(root).catch(() => root);
  const files: PreparedFile[] = [];
  for (const [relativeFilePath, entries] of translatedByFile.entries()) {
    // Validate before any join so a traversal attempt fails loudly instead of
    // being swallowed by the unreadable-file skip below.
    assertSafeRelativePath(relativeFilePath);
    const sourcePath = path.join(root, relativeFilePath);
    try {
      // Defense-in-depth over the lexical check: a symlink inside the project must
      // not resolve the read/write target outside it (an in-place write follows it).
      const realSource = await realpath(sourcePath);
      if (realSource !== realRoot && !isInsideDirectory(realRoot, realSource)) {
        throw new Error("resolves outside the project directory via a symlink");
      }
      const preparedFile = relativeFilePath.endsWith("js/plugins.js")
        ? await preparePluginsFile(relativeFilePath, sourcePath, entries)
        : await prepareJsonFile(relativeFilePath, sourcePath, entries);

      // A per-file skip is a source mismatch (the game value no longer equals the
      // unit's source) — an unmatched skip, not an unfinished translation.
      skipped += preparedFile.skipped;
      skippedUnmatched += preparedFile.skipped;
      if (preparedFile.unitsApplied > 0) {
        files.push(preparedFile);
      }
    } catch (error: unknown) {
      // A source file that cannot be read, parsed, or safely resolved (e.g. a
      // non-standard plugins.js) is skipped so its translations do not abort the
      // whole patch — but the reason is surfaced rather than silently counted.
      skipped += entries.length;
      const message = error instanceof Error ? error.message : String(error);
      onWarning?.(`Skipped ${relativeFilePath} (${entries.length} translation(s)): ${message}`);
    }
  }

  return { files, skipped, skippedUnmatched };
}

async function prepareJsonFile(
  relativeFilePath: string,
  sourcePath: string,
  entries: FileEntry[]
): Promise<PreparedFile> {
  const raw = await readFile(sourcePath, "utf8");
  const style = detectJsonStyle(raw);
  const data = JSON.parse(style.bom ? raw.slice(1) : raw);
  let unitsApplied = 0;
  let skipped = 0;

  for (const { unit, result } of entries) {
    const currentValue = getJsonPath(data, unit.jsonPath);
    if (currentSourceValue(currentValue, unit) !== unit.source) {
      skipped += 1;
      continue;
    }
    setJsonPath(data, unit.jsonPath, encodeTranslation(unit, currentValue, restorePlaceholders(result.translation, unit.placeholders)));
    unitsApplied += 1;
  }

  return { relativeFilePath, sourcePath, content: data, format: "json", style, unitsApplied, skipped };
}

async function preparePluginsFile(
  relativeFilePath: string,
  sourcePath: string,
  entries: FileEntry[]
): Promise<PreparedFile> {
  const raw = await readFile(sourcePath, "utf8");
  const plugins = parsePluginsJs(raw);
  let unitsApplied = 0;
  let skipped = 0;

  for (const { unit, result } of entries) {
    const currentValue = getPluginParameter(plugins, unit.jsonPath);
    if (currentSourceValue(currentValue, unit) !== unit.source) {
      skipped += 1;
      continue;
    }
    setPluginParameter(plugins, unit.jsonPath, encodeTranslation(unit, currentValue, restorePlaceholders(result.translation, unit.placeholders)));
    unitsApplied += 1;
  }

  return {
    relativeFilePath,
    sourcePath,
    content: replacePluginsArray(raw, plugins),
    format: "text",
    unitsApplied,
    skipped
  };
}
