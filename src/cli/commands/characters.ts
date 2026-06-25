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

import {
  candidatesToDraftGlossary,
  extractCharacterCandidates,
  inferCharacterGlossary
} from "../../core/pipeline/public-api.js";
import {
  readTranslationResultsFile,
  readTranslationUnitsFile
} from "../../core/translation-units.js";
import { TokenBudget } from "../../core/cost.js";
import { createProvider } from "../../providers/public-api.js";
import { writeJson } from "../file-utils.js";
import {
  assertProviderReady,
  echoTargetLanguage,
  hasFlag,
  readOption,
  readPositiveIntegerOption,
  readProviderCliOptions,
  readProviderConfig,
  readProviderName,
  requirePositional,
  requireOption
} from "../options/public-api.js";
import type { CliIO } from "../types.js";

export async function charactersCommand(args: string[], io: CliIO): Promise<number> {
  const unitsPath = requirePositional(args, 0, "units path");
  const out = requireOption(args, "--out");
  const translationsPath = readOption(args, "--translations");
  const providerName = readProviderName(args);
  if (providerName !== "none" && !hasFlag(args, "--draft-only")) {
    assertProviderReady(providerName);
  }
  const providerOptions = readProviderCliOptions(args);
  echoTargetLanguage(args, io.stderr);
  const tokenBudgetLimit = readPositiveIntegerOption(args, "--max-tokens-budget");
  const budget = tokenBudgetLimit != null ? new TokenBudget(tokenBudgetLimit) : undefined;
  const units = await readTranslationUnitsFile(unitsPath);
  const translations = translationsPath ? await readTranslationResultsFile(translationsPath) : [];
  const candidates = extractCharacterCandidates(units, translations, {
    includeDialogueMentions: hasFlag(args, "--include-mentions")
  });
  const glossary =
    providerName === "none" || hasFlag(args, "--draft-only")
      ? candidatesToDraftGlossary(candidates)
      : await inferCharacterGlossary(
          candidates,
          createProvider(providerName, readProviderConfig(args)),
          {
            ...providerOptions,
            onWarning: (message) => io.stderr(`Warning: ${message}\n`)
          },
          budget
        );
  await writeJson(out, glossary);
  io.stderr(`Character candidates: ${candidates.length}. Wrote ${Object.keys(glossary).length} character entries.\n`);
  return 0;
}
