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
import type { ApplyOptions, ApplyResult, TranslationResult, TranslationUnit } from "../../../core/types/public-api.js";
import { assertBackupDirSafe, assertPatchOutputOutsideGame } from "./paths.js";
import { prepareFiles, type PreparedFileSet } from "./prepare.js";
import { writeInPlaceFiles, writePatchFiles } from "./publish.js";

// Apply translations to a project's files, either into a separate patch directory
// or in place with a backup. The work is split into prepare (in memory) and publish
// (atomic write) so a dry run can report the outcome without touching disk.
export async function writePatch(
  projectPath: string,
  units: TranslationUnit[],
  translations: TranslationResult[],
  options: ApplyOptions
): Promise<ApplyResult> {
  if (options.mode !== "patch" && options.mode !== "in-place") {
    throw new Error(`Patch writer supports patch and in-place modes, got '${options.mode}'`);
  }
  if (options.mode === "patch" && !options.outDir) {
    throw new Error("Patch mode requires options.outDir");
  }
  if (options.mode === "patch") {
    assertPatchOutputOutsideGame(projectPath, options.outDir ?? "");
  }

  const root = path.resolve(projectPath);
  if (options.mode === "in-place" && options.backupDir != null) {
    assertBackupDirSafe(root, options.backupDir);
  }
  const prepared = await prepareFiles(root, units, translations, options.onWarning);

  if (options.dryRun) {
    return previewResult(root, options, prepared);
  }

  if (options.mode === "patch") {
    return writePatchFiles(prepared, path.resolve(options.outDir ?? ""), prepared.skipped);
  }

  return writeInPlaceFiles(root, prepared, options);
}

// Report what a patch/in-place run would do without writing anything.
function previewResult(root: string, options: ApplyOptions, prepared: PreparedFileSet): ApplyResult {
  const baseDir = options.mode === "patch" ? path.resolve(options.outDir ?? "") : root;
  const result: ApplyResult = {
    mode: options.mode,
    filesWritten: prepared.files.map((file) => path.join(baseDir, file.relativeFilePath)),
    unitsApplied: prepared.files.reduce((total, file) => total + file.unitsApplied, 0),
    skipped: prepared.skipped,
    skippedUnmatched: prepared.skippedUnmatched
  };
  if (options.mode === "in-place" && options.backupDir) {
    result.backupDir = options.backupDir;
  }
  return result;
}
