import { createReport, summarizeReport, writeReportFile } from "../../core/reports/index.js";
import {
  readTranslationResultsFile,
  readTranslationUnitsFile
} from "../../core/translation-units/index.js";
import { DefaultValidator, validateTranslationResults } from "../../core/validators/index.js";
import { loadGlossary } from "../../config/index.js";
import { readOption, requireArg } from "../options.js";
import type { CliIO } from "../types.js";

export async function validateCommand(args: string[], io: CliIO): Promise<number> {
  const unitsPath = requireArg(args[0], "units path");
  const translationsPath = requireArg(args[1], "translations path");
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
  return 0;
}
