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

import type { CharacterGlossary, Glossary, ReviewUnit, TranslationUnit } from "../../core/types/public-api.js";
import { glossaryTermMatches } from "../../core/utils/text.js";

// Even after relevance filtering, a large glossary against a batch of common terms
// (or short CJK substrings) can match enough entries to inflate the prompt and risk
// truncating the actual translation payload. Bound the count per batch.
const MAX_GLOSSARY_ENTRIES_PER_BATCH = 100;

// Character entries are richer (gender, speechStyle, aliases) so each costs more
// tokens; cap them lower than term-glossary entries to keep the payload in budget.
const MAX_CHARACTER_ENTRIES_PER_BATCH = 50;

function capRelevant(
  matched: Array<[string, Glossary[string]]>,
  onWarning?: (message: string) => void
): Glossary {
  if (matched.length <= MAX_GLOSSARY_ENTRIES_PER_BATCH) {
    return Object.fromEntries(matched);
  }
  // Keep the most specific terms — a longer term is less likely to be an incidental
  // match — and drop the rest, warning so the truncation is not silent.
  const kept = [...matched].sort(([a], [b]) => b.length - a.length).slice(0, MAX_GLOSSARY_ENTRIES_PER_BATCH);
  onWarning?.(
    `Glossary matched ${matched.length} terms for a batch; keeping the ${MAX_GLOSSARY_ENTRIES_PER_BATCH} most specific to keep the prompt within budget.`
  );
  return Object.fromEntries(kept);
}

export function filterGlossaryForBatch(
  glossary: Glossary | undefined,
  batch: TranslationUnit[],
  onWarning?: (message: string) => void
): Glossary {
  if (!glossary) {
    return {};
  }

  const matched = Object.entries(glossary).filter(([term]) =>
    batch.some((unit) => glossaryTermMatches(unit.source, term) || glossaryTermMatches(unit.normalizedSource ?? "", term))
  );
  return capRelevant(matched, onWarning);
}

export function filterGlossaryForReviewBatch(
  glossary: Glossary | undefined,
  batch: ReviewUnit[],
  onWarning?: (message: string) => void
): Glossary {
  if (!glossary) {
    return {};
  }

  const matched = Object.entries(glossary).filter(([term]) =>
    batch.some(
      (unit) =>
        glossaryTermMatches(unit.source, term) ||
        glossaryTermMatches(unit.normalizedSource ?? "", term) ||
        glossaryTermMatches(unit.currentTranslation ?? "", term)
    )
  );
  return capRelevant(matched, onWarning);
}

// Keep only the character entries whose name or an alias appears in the batch's
// text (or matches a unit's speaker), so a large cast does not flood every prompt
// with unrelated characters. Mirrors the term-glossary filter + cap.
function filterCharacters(
  characters: CharacterGlossary,
  texts: string[],
  onWarning?: (message: string) => void
): CharacterGlossary {
  const present = texts.filter((text) => text.length > 0);
  const matched = Object.entries(characters).filter(([name, entry]) =>
    [name, ...(entry.aliases ?? [])].some((term) => present.some((text) => glossaryTermMatches(text, term)))
  );
  if (matched.length <= MAX_CHARACTER_ENTRIES_PER_BATCH) {
    return Object.fromEntries(matched);
  }
  const kept = [...matched].sort(([a], [b]) => b.length - a.length).slice(0, MAX_CHARACTER_ENTRIES_PER_BATCH);
  onWarning?.(
    `Character glossary matched ${matched.length} entries for a batch; keeping the ${MAX_CHARACTER_ENTRIES_PER_BATCH} most specific to keep the prompt within budget.`
  );
  return Object.fromEntries(kept);
}

export function filterCharacterGlossaryForBatch(
  characters: CharacterGlossary | undefined,
  batch: TranslationUnit[],
  onWarning?: (message: string) => void
): CharacterGlossary {
  if (!characters) {
    return {};
  }
  const texts = batch.flatMap((unit) => [unit.source, unit.normalizedSource ?? "", unit.context?.speaker ?? ""]);
  return filterCharacters(characters, texts, onWarning);
}

export function filterCharacterGlossaryForReviewBatch(
  characters: CharacterGlossary | undefined,
  batch: ReviewUnit[],
  onWarning?: (message: string) => void
): CharacterGlossary {
  if (!characters) {
    return {};
  }
  const texts = batch.flatMap((unit) => [
    unit.source,
    unit.normalizedSource ?? "",
    unit.currentTranslation ?? "",
    unit.context?.speaker ?? ""
  ]);
  return filterCharacters(characters, texts, onWarning);
}
