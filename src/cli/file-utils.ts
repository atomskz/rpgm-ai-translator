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

import { summarizeReport, writeReportFile } from "../core/reports/public-api.js";
import type { createReport } from "../core/reports/public-api.js";
import { writeFileAtomic } from "../core/utils/fs.js";
import type { CliIO } from "./types.js";

export async function maybeWriteReport(
  reportPath: string | undefined,
  report: ReturnType<typeof createReport>,
  io: CliIO
): Promise<void> {
  if (!reportPath) {
    return;
  }

  await writeReportFile(reportPath, report);
  // The report file is the machine artifact; the summary is human, so it goes to
  // stderr and never mixes into a piped machine payload (e.g. extract's units).
  io.stderr(`${summarizeReport(report)}\n`);
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
