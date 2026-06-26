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

import type { BatchFailureSummary, TranslationResult } from "../types/public-api.js";

// A short suffix naming the most common failure reason across the results, for the
// total-failure abort message so the pasted line is self-explanatory (auth vs
// billing vs network vs truncation) instead of just "all units failed". Empty when
// nothing failed.
export function dominantFailureCause(results: TranslationResult[]): string {
  const summary = summarizeBatchFailures(results);
  if (summary.length === 0) {
    return "";
  }
  const top = summary[0];
  return ` Dominant cause: ${top.code} — ${top.message}.`;
}

// Aggregate the distinct failure reasons across a batch's results so progress
// output can name the cause (auth, network, schema...) instead of just a count.
// Grouped by issue code, keeping the first message seen and ordered by how many
// failed-unit issues carried that code (descending) so the dominant cause leads.
export function summarizeBatchFailures(results: TranslationResult[]): BatchFailureSummary[] {
  const byCode = new Map<string, { message: string; count: number }>();
  for (const result of results) {
    if (result.status !== "failed") {
      continue;
    }
    const issues = result.issues ?? [];
    if (issues.length === 0) {
      recordReason(byCode, "UNKNOWN", "No failure detail was attached to the unit.");
      continue;
    }
    for (const issue of issues) {
      recordReason(byCode, issue.code, issue.message);
    }
  }
  return [...byCode.entries()]
    .map(([code, { message, count }]) => ({ code, message, count }))
    .sort((a, b) => b.count - a.count);
}

function recordReason(byCode: Map<string, { message: string; count: number }>, code: string, message: string): void {
  const existing = byCode.get(code);
  if (existing) {
    existing.count += 1;
    return;
  }
  byCode.set(code, { message, count: 1 });
}
