import {
  candidatesToDraftGlossary,
  extractCharacterCandidates,
  inferCharacterGlossary
} from "../../core/characters/index.js";
import {
  readTranslationResultsFile,
  readTranslationUnitsFile
} from "../../core/translation-units/index.js";
import { createProvider } from "../../providers/index.js";
import { writeJson } from "../file-utils.js";
import {
  assertProviderReady,
  hasFlag,
  readOption,
  readProviderCliOptions,
  readProviderName,
  requireArg,
  requireOption
} from "../options.js";
import type { CliIO } from "../types.js";

export async function charactersCommand(args: string[], io: CliIO): Promise<number> {
  const unitsPath = requireArg(args[0], "units path");
  const out = requireOption(args, "--out");
  const translationsPath = readOption(args, "--translations");
  const providerName = readProviderName(args);
  if (providerName !== "none" && !hasFlag(args, "--draft-only")) {
    assertProviderReady(providerName);
  }
  const providerOptions = readProviderCliOptions(args);
  const units = await readTranslationUnitsFile(unitsPath);
  const translations = translationsPath ? await readTranslationResultsFile(translationsPath) : [];
  const candidates = extractCharacterCandidates(units, translations, {
    includeDialogueMentions: hasFlag(args, "--include-mentions")
  });
  const glossary =
    providerName === "none" || hasFlag(args, "--draft-only")
      ? candidatesToDraftGlossary(candidates)
      : await inferCharacterGlossary(candidates, createProvider(providerName), providerOptions);
  await writeJson(out, glossary);
  io.stdout(`Character candidates: ${candidates.length}. Wrote ${Object.keys(glossary).length} character entries.\n`);
  return 0;
}
