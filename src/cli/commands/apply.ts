import { applyFontPatch } from "../../core/font-patch/index.js";
import { writePatch } from "../../core/patch-writer/index.js";
import { readReportFile } from "../../core/reports/index.js";
import {
  readTranslationResultsFile,
  readTranslationUnitsFile
} from "../../core/translation-units/index.js";
import { filterTranslationsWithoutValidationErrors } from "../../core/validators/index.js";
import { RpgMakerMvMzExtractor } from "../../core/extractors/index.js";
import { readApplyOptions, readFontOptions, readOption, requireArg } from "../options.js";
import type { CliIO } from "../types.js";

export async function applyCommand(args: string[], io: CliIO): Promise<number> {
  const projectPath = requireArg(args[0], "project path");
  const translationsPath = requireArg(args[1], "translations path");
  const applyOptions = readApplyOptions(args);
  const { fontPath, numberFontPath } = readFontOptions(args);
  const reportPath = readOption(args, "--report");
  const unitsPath = readOption(args, "--units");
  const translations = await readTranslationResultsFile(translationsPath);
  const translationsToApply = reportPath
    ? filterTranslationsWithoutValidationErrors(translations, (await readReportFile(reportPath)).validationIssues)
    : translations;
  if (reportPath) {
    io.stdout(`Using report filter: ${translationsToApply.length}/${translations.length} validation-safe translations.\n`);
  }
  io.stdout(`${applyOptions.dryRun ? "[dry run] Previewing" : "Applying"} translations in ${applyOptions.mode} mode...\n`);
  const result = unitsPath
    ? await writePatch(projectPath, await readTranslationUnitsFile(unitsPath), translationsToApply, applyOptions)
    : await new RpgMakerMvMzExtractor().applyTranslations(projectPath, translationsToApply, applyOptions);
  if (applyOptions.mode === "patch" && applyOptions.outDir && fontPath && !applyOptions.dryRun) {
    io.stdout("Applying font patch...\n");
    await applyFontPatch(projectPath, applyOptions.outDir, { fontPath, numberFontPath });
  }
  if (applyOptions.dryRun) {
    io.stdout(
      `[dry run] Would write ${result.filesWritten.length} file(s), apply ${result.unitsApplied} unit(s), skip ${result.skipped}. No files were written.\n`
    );
  }
  io.stdout(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}
