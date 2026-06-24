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

import type { Glossary, ReviewUnit, TranslationUnit } from "../../core/types.js";
import { glossaryTermMatches } from "../../core/utils/text.js";

export function filterGlossaryForBatch(glossary: Glossary | undefined, batch: TranslationUnit[]): Glossary {
  if (!glossary) {
    return {};
  }

  const relevant: Glossary = {};
  for (const [term, entry] of Object.entries(glossary)) {
    if (
      batch.some(
        (unit) => glossaryTermMatches(unit.source, term) || glossaryTermMatches(unit.normalizedSource ?? "", term)
      )
    ) {
      relevant[term] = entry;
    }
  }
  return relevant;
}

export function filterGlossaryForReviewBatch(glossary: Glossary | undefined, batch: ReviewUnit[]): Glossary {
  if (!glossary) {
    return {};
  }

  const relevant: Glossary = {};
  for (const [term, entry] of Object.entries(glossary)) {
    if (
      batch.some(
        (unit) =>
          glossaryTermMatches(unit.source, term) ||
          glossaryTermMatches(unit.normalizedSource ?? "", term) ||
          glossaryTermMatches(unit.currentTranslation ?? "", term)
      )
    ) {
      relevant[term] = entry;
    }
  }
  return relevant;
}
