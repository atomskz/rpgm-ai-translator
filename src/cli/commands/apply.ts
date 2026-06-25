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

import { applyFontPatch } from "../../engines/rpgmaker-mvmz/font.js";
import { writePatch } from "../../engines/rpgmaker-mvmz/patch/public-api.js";
import { readReportFile } from "../../core/reports/public-api.js";
import {
  readTranslationResultsFile,
  readTranslationUnitsFile
} from "../../core/translation-units.js";
import { filterTranslationsWithoutValidationErrors } from "../../core/validators/public-api.js";
import { RpgMakerMvMzExtractor } from "../../engines/rpgmaker-mvmz/extractor.js";
import { readApplyOptions, readFontOptions, readOption, requirePositional, UsageError } from "../options.js";
import type { CliIO } from "../types.js";

export async function applyCommand(args: string[], io: CliIO): Promise<number> {
  const projectPath = requirePositional(args, 0, "project path");
  const translationsPath = requirePositional(args, 1, "translations path");
  const applyOptions = readApplyOptions(args);
  applyOptions.onWarning = (message) => io.stderr(`Warning: ${message}\n`);
  // Patch mode writes into --out; without it writePatch throws deep in the writer
  // with no usage hint. Fail early as a UsageError, like patch-font and run do.
  if (applyOptions.mode === "patch" && !applyOptions.outDir) {
    throw new UsageError("apply in patch mode requires --out <dir>");
  }
  const { fontPath, numberFontPath } = readFontOptions(args);
  const reportPath = readOption(args, "--report");
  const unitsPath = readOption(args, "--units");
  const translations = await readTranslationResultsFile(translationsPath);
  const translationsToApply = reportPath
    ? filterTranslationsWithoutValidationErrors(translations, (await readReportFile(reportPath)).validationIssues)
    : translations;
  if (reportPath) {
    io.stderr(`Using report filter: ${translationsToApply.length}/${translations.length} validation-safe translations.\n`);
  }
  io.stderr(`${applyOptions.dryRun ? "[dry run] Previewing" : "Applying"} translations in ${applyOptions.mode} mode...\n`);
  const result = unitsPath
    ? await writePatch(projectPath, await readTranslationUnitsFile(unitsPath), translationsToApply, applyOptions)
    : await new RpgMakerMvMzExtractor().applyTranslations(projectPath, translationsToApply, applyOptions);
  // Without --units, apply re-extracts the game and matches by id. If the saved
  // translations came from a different extraction (e.g. --include-plugins), ids
  // will not match and get silently skipped. Warn (and exit non-zero below) on an
  // id/source mismatch only — a translation that was simply never produced
  // (failed/empty) is a different problem and must not be blamed on a flag mismatch.
  const considered = result.unitsApplied + result.skippedUnmatched;
  if (!unitsPath && result.skippedUnmatched > 0) {
    const severe = result.skippedUnmatched >= considered / 2;
    io.stderr(
      `Warning: skipped ${result.skippedUnmatched}/${considered} translation(s) because their ids did not match the re-extracted units.` +
        (severe ? " Most translations were dropped." : "") +
        " If you extracted with different flags (for example --include-plugins or --include-speaker-names), pass --units <units.json> so ids match exactly.\n"
    );
  }
  if (applyOptions.mode === "patch" && applyOptions.outDir && fontPath && !applyOptions.dryRun) {
    io.stderr("Applying font patch...\n");
    await applyFontPatch(projectPath, applyOptions.outDir, {
      fontPath,
      numberFontPath,
      onWarning: (warning) => io.stderr(`Warning: ${warning}\n`)
    });
  }
  // Print a human-readable summary instead of the raw result JSON, which a
  // non-programmer cannot read; the file output is the artifact that matters.
  if (applyOptions.dryRun) {
    io.stderr(
      `[dry run] Would write ${result.filesWritten.length} file(s), apply ${result.unitsApplied} unit(s), skip ${result.skipped}. No files were written.\n`
    );
  } else {
    const backup = result.backupDir ? ` Backup: ${result.backupDir}.` : "";
    io.stderr(
      `Applied ${result.unitsApplied} translation(s) to ${result.filesWritten.length} file(s); skipped ${result.skipped}.${backup}\n`
    );
  }
  // Without --units, an id mismatch can skip most of the translations and write an
  // almost-empty patch. Exit non-zero on a majority id/source mismatch so a wrapping
  // script does not mistake it for a successful apply; a partial mismatch (<50%)
  // still warns and succeeds, and unproduced translations never trip this.
  if (!unitsPath && !applyOptions.dryRun && considered > 0 && result.skippedUnmatched >= considered / 2) {
    return 1;
  }
  return 0;
}
