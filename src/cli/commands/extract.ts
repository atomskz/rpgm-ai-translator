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

import { RpgMakerMvMzExtractor } from "../../core/extractors/index.js";
import { createReport } from "../../core/reports/index.js";
import { writeTranslationUnitsFile } from "../../core/translation-units/index.js";
import { maybeWriteReport } from "../file-utils.js";
import { readExtractOptions, readOption, requireArg } from "../options.js";
import type { CliIO } from "../types.js";

export async function extractCommand(args: string[], io: CliIO): Promise<number> {
  const projectPath = requireArg(args[0], "project path");
  const out = readOption(args, "--out");
  const reportPath = readOption(args, "--report");
  const warnings: string[] = [];
  const units = await new RpgMakerMvMzExtractor().extract(projectPath, {
    ...readExtractOptions(args),
    onWarning: (warning) => warnings.push(warning)
  });
  if (out) {
    await writeTranslationUnitsFile(out, units);
  } else {
    io.stdout(`${JSON.stringify(units, null, 2)}\n`);
  }
  for (const warning of warnings) {
    io.stderr(`Warning: ${warning}\n`);
  }
  await maybeWriteReport(reportPath, createReport({ units, warnings }), io);
  return 0;
}
