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

import type { TranslationResult } from "../types.js";

export type RevalidatedBatch = {
  checkpointResults: TranslationResult[];
  failed: number;
};

/**
 * Shared per-batch processing for the review and repair passes. A non-translated
 * result is recorded as a failure as-is; a translated one is turned into the
 * accepted candidate via `buildAccepted`, and if `rejectIfRegressed` finds it made
 * the translation worse, the returned kept-previous substitute is recorded as a
 * failure instead of the candidate. Accepted candidates are written to
 * `acceptedById`. Centralizes the accept/reject/rollback shape both passes
 * previously duplicated, while each pass keeps its own merge and regression rules.
 */
export function collectRevalidatedBatch(
  results: TranslationResult[],
  acceptedById: Map<string, TranslationResult>,
  buildAccepted: (result: TranslationResult) => TranslationResult,
  rejectIfRegressed: (accepted: TranslationResult) => TranslationResult | undefined
): RevalidatedBatch {
  const checkpointResults: TranslationResult[] = [];
  let failed = 0;

  for (const result of results) {
    if (result.status !== "translated") {
      failed += 1;
      checkpointResults.push(result);
      continue;
    }
    const accepted = buildAccepted(result);
    const regressed = rejectIfRegressed(accepted);
    if (regressed) {
      failed += 1;
      checkpointResults.push(regressed);
      continue;
    }
    acceptedById.set(result.id, accepted);
    checkpointResults.push(accepted);
  }

  return { checkpointResults, failed };
}
