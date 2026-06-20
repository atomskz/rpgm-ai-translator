import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { summarizeReport, writeReportFile } from "../core/reports/index.js";
import type { createReport } from "../core/reports/index.js";
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
  io.stdout(`${summarizeReport(report)}\n`);
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
