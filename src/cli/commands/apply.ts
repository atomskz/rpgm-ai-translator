import { applyFontPatch } from "../../core/font-patch/index.js";
import { writePatch } from "../../core/patch-writer/index.js";
import { readReportFile } from "../../core/reports/index.js";
import {
  readTranslationResultsFile,
  readTranslationUnitsFile
} from "../../core/translation-units/index.js";
import { filterTranslationsWithoutValidationErrors } from "../../core/validators/index.js";
import { RpgMakerMvMzExtractor } from "../../core/extractors/index.js";
import { hasFlag, readOption, requireArg } from "../options.js";
import type { CliIO } from "../types.js";

export async function applyCommand(args: string[], io: CliIO): Promise<number> {
  const projectPath = requireArg(args[0], "project path");
  const translationsPath = requireArg(args[1], "translations path");
  const mode = readOption(args, "--mode") ?? "patch";
  const outDir = readOption(args, "--out");
  const backupDir = readOption(args, "--backup");
  const reportPath = readOption(args, "--report");
  const unitsPath = readOption(args, "--units");
  const fontPath = readOption(args, "--font");
  const numberFontPath = readOption(args, "--number-font");
  const translations = await readTranslationResultsFile(translationsPath);
  const translationsToApply = reportPath
    ? filterTranslationsWithoutValidationErrors(translations, (await readReportFile(reportPath)).validationIssues)
    : translations;
  if (reportPath) {
    io.stdout(`Using report filter: ${translationsToApply.length}/${translations.length} validation-safe translations.\n`);
  }
  io.stdout(`Applying translations in ${mode} mode...\n`);
  const applyOptions = {
    mode: mode as "patch" | "in-place",
    outDir,
    backupDir,
    includePlugins: hasFlag(args, "--include-plugins"),
    includeSpeakerNames: hasFlag(args, "--include-speaker-names")
  };
  const result = unitsPath
    ? await writePatch(projectPath, await readTranslationUnitsFile(unitsPath), translationsToApply, applyOptions)
    : await new RpgMakerMvMzExtractor().applyTranslations(projectPath, translationsToApply, applyOptions);
  if (mode === "patch" && outDir && fontPath) {
    io.stdout("Applying font patch...\n");
    await applyFontPatch(projectPath, outDir, { fontPath, numberFontPath });
  }
  io.stdout(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}
