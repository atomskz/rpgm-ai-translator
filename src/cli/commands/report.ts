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

import { readReportFile, summarizeReportToMarkdown } from "../../core/reports/public-api.js";
import { readTranslationResultsFile, readTranslationUnitsFile } from "../../core/translation-units.js";
import { writeFileAtomic } from "../../core/utils/fs.js";
import { readOption, readPositionals, requireOption, requirePositional, UsageError } from "../options/public-api.js";
import type { CliIO } from "../types.js";

// Turn the JSON validation report into a human-readable Markdown review doc that
// joins each issue to its source, translation and file location — so a translator
// can see and act on what to fix without reading the raw report JSON.
export async function reportCommand(args: string[], io: CliIO): Promise<number> {
  const subcommand = readPositionals(args)[0];
  if (subcommand !== "summarize") {
    throw new UsageError(
      "Usage: report summarize <report.json> --units <units.json> --translations <translations.json> [--out <file.md>]"
    );
  }
  const reportPath = requirePositional(args, 1, "report path");
  const unitsPath = requireOption(args, "--units");
  const translationsPath = requireOption(args, "--translations");
  const out = readOption(args, "--out");

  const report = await readReportFile(reportPath);
  const units = await readTranslationUnitsFile(unitsPath);
  const translations = await readTranslationResultsFile(translationsPath);
  const markdown = summarizeReportToMarkdown(report, units, translations);
  const payload = markdown.endsWith("\n") ? markdown : `${markdown}\n`;

  if (out) {
    await writeFileAtomic(out, payload);
    io.stderr(`Wrote review document: ${out}\n`);
  } else {
    io.stdout(payload);
  }
  return 0;
}
