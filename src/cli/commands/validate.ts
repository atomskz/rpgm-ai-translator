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

import { createReport, summarizeReport, writeReportFile } from "../../core/reports/index.js";
import {
  readTranslationResultsFile,
  readTranslationUnitsFile
} from "../../core/translation-units/index.js";
import { DefaultValidator, validateTranslationResults } from "../../core/validators/index.js";
import { loadGlossary } from "../../config/index.js";
import { readOption, requirePositional } from "../options.js";
import type { CliIO } from "../types.js";

export async function validateCommand(args: string[], io: CliIO): Promise<number> {
  const unitsPath = requirePositional(args, 0, "units path");
  const translationsPath = requirePositional(args, 1, "translations path");
  const out = readOption(args, "--out");
  const glossaryPath = readOption(args, "--glossary");
  const units = await readTranslationUnitsFile(unitsPath);
  const translations = await readTranslationResultsFile(translationsPath);
  const glossary = glossaryPath ? await loadGlossary(glossaryPath) : undefined;
  const validationIssues = validateTranslationResults(units, translations, new DefaultValidator(glossary));
  const report = createReport({ units, translations, validationIssues });
  if (out) {
    await writeReportFile(out, report);
    io.stdout(`${summarizeReport(report)}\n`);
  } else {
    io.stdout(`${JSON.stringify(report, null, 2)}\n`);
  }
  // Exit non-zero when the report contains apply-blocking errors so `validate`
  // can gate a CI pipeline or a `validate && apply` shell chain. Warnings alone
  // (e.g. glossary advisories) keep the success code.
  const errorCount = validationIssues.filter((item) => item.severity === "error").length;
  if (errorCount > 0) {
    io.stderr(`Validation found ${errorCount} blocking error${errorCount === 1 ? "" : "s"}.\n`);
    return 2;
  }
  return 0;
}
