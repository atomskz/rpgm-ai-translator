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
  const units = await new RpgMakerMvMzExtractor().extract(projectPath, readExtractOptions(args));
  if (out) {
    await writeTranslationUnitsFile(out, units);
  } else {
    io.stdout(`${JSON.stringify(units, null, 2)}\n`);
  }
  await maybeWriteReport(reportPath, createReport({ units }), io);
  return 0;
}
