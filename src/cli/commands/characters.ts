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
  readNumberOption,
  readOption,
  readPositiveIntegerOption,
  requireArg,
  requireOption
} from "../options.js";
import type { CliIO } from "../types.js";

export async function charactersCommand(args: string[], io: CliIO): Promise<number> {
  const unitsPath = requireArg(args[0], "units path");
  const out = requireOption(args, "--out");
  const translationsPath = readOption(args, "--translations");
  const providerName = readOption(args, "--provider") ?? "mock";
  if (providerName !== "none" && !hasFlag(args, "--draft-only")) {
    assertProviderReady(providerName);
  }
  const targetLanguage = readOption(args, "--target") ?? "ru";
  const model = readOption(args, "--model");
  const batchSize = readPositiveIntegerOption(args, "--batch-size");
  const timeoutMs = readPositiveIntegerOption(args, "--timeout-ms");
  const temperature = readNumberOption(args, "--temperature", { min: 0, max: 2 });
  const maxTokens = readPositiveIntegerOption(args, "--max-tokens");
  const units = await readTranslationUnitsFile(unitsPath);
  const translations = translationsPath ? await readTranslationResultsFile(translationsPath) : [];
  const candidates = extractCharacterCandidates(units, translations, {
    includeDialogueMentions: hasFlag(args, "--include-mentions")
  });
  const glossary =
    providerName === "none" || hasFlag(args, "--draft-only")
      ? candidatesToDraftGlossary(candidates)
      : await inferCharacterGlossary(candidates, createProvider(providerName), {
          targetLanguage,
          model,
          batchSize,
          timeoutMs,
          temperature,
          maxTokens
        });
  await writeJson(out, glossary);
  io.stdout(`Character candidates: ${candidates.length}. Wrote ${Object.keys(glossary).length} character entries.\n`);
  return 0;
}
