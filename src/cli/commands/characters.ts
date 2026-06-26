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
import { loadCharacterGlossary } from "../../config/public-api.js";
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
  readPositionals,
  readPositiveIntegerOption,
  readProviderCliOptions,
  readProviderConfig,
  readProviderName,
  requirePositional,
  requireOption
} from "../options/public-api.js";
import type { CliIO } from "../types.js";

export async function charactersCommand(args: string[], io: CliIO): Promise<number> {
  // `characters check <characters.json>` validates an existing glossary instead of
  // generating one; it needs no provider, units, or --out.
  if (readPositionals(args)[0] === "check") {
    return checkCharacterGlossary(args, io);
  }
  const unitsPath = requirePositional(args, 0, "units path");
  const out = requireOption(args, "--out");
  // Accept the translations file as an optional second positional (consistent with
  // review/validate/repair); --translations stays as a deprecated alias one release.
  const translationsPath = readPositionals(args)[1] ?? readOption(args, "--translations");
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

// Validate a character glossary (enum gender/type, alias shape via the loader) and
// list the entries flagged review:true so the human knows what still needs a look.
// Exits non-zero on an invalid file so a CI check or wrapper can gate on it.
async function checkCharacterGlossary(args: string[], io: CliIO): Promise<number> {
  const charactersPath = requirePositional(args, 1, "characters path");
  let glossary;
  try {
    glossary = await loadCharacterGlossary(charactersPath);
  } catch (error: unknown) {
    io.stderr(`Invalid character glossary: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  const names = Object.keys(glossary);
  const needReview = names.filter((name) => glossary[name].review === true);
  io.stderr(`Character glossary '${charactersPath}' is valid: ${names.length} entr${names.length === 1 ? "y" : "ies"}.\n`);
  if (needReview.length > 0) {
    io.stdout(`${needReview.length} entr${needReview.length === 1 ? "y" : "ies"} flagged review:true:\n${needReview.map((name) => `- ${name}`).join("\n")}\n`);
  } else {
    io.stderr("No entries are flagged for review.\n");
  }
  return 0;
}
