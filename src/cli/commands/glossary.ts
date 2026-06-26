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

import { loadGlossary } from "../../config/public-api.js";
import { protectPlaceholders } from "../../core/placeholders.js";
import { readTranslationUnitsFile } from "../../core/translation-units.js";
import type { Glossary, TranslationUnit } from "../../core/types/public-api.js";
import { writeJson } from "../file-utils.js";
import {
  readOption,
  readPositionals,
  readPositiveIntegerOption,
  requirePositional,
  UsageError
} from "../options/public-api.js";
import type { CliIO } from "../types.js";

const DEFAULT_MIN_OCCURRENCES = 2;

export async function glossaryCommand(args: string[], io: CliIO): Promise<number> {
  const sub = readPositionals(args)[0];
  if (sub === "extract") {
    return extractGlossary(args, io);
  }
  if (sub === "check") {
    return checkGlossary(args, io);
  }
  throw new UsageError("glossary requires a subcommand: 'extract' or 'check'.");
}

// Draft a glossary by mining frequent proper nouns from a units file: capitalized
// words that recur and never appear lowercased (so a sentence-initial common word
// like "The" is excluded because "the" also occurs). Emitted in mode "keep" as a
// starting point for the translator to edit, not a finished glossary.
async function extractGlossary(args: string[], io: CliIO): Promise<number> {
  const unitsPath = requirePositional(args, 1, "units path");
  const minOccurrences = readPositiveIntegerOption(args, "--min-occurrences") ?? DEFAULT_MIN_OCCURRENCES;
  const units = await readTranslationUnitsFile(unitsPath);
  const glossary = mineGlossaryTerms(units, minOccurrences);
  const count = Object.keys(glossary).length;
  const out = readOption(args, "--out");
  if (out) {
    await writeJson(out, glossary);
    io.stderr(`Drafted ${count} glossary term${count === 1 ? "" : "s"} to ${out} (mode "keep"; review and edit).\n`);
  } else {
    io.stdout(`${JSON.stringify(glossary, null, 2)}\n`);
    io.stderr(`Drafted ${count} glossary term${count === 1 ? "" : "s"} (mode "keep"; review and edit).\n`);
  }
  return 0;
}

const WORD_RE = /\p{L}[\p{L}\p{M}]*/gu;
const UPPERCASE_START_RE = /^\p{Lu}/u;

function mineGlossaryTerms(units: TranslationUnit[], minOccurrences: number): Glossary {
  const capCounts = new Map<string, number>();
  const lowerForms = new Set<string>();

  for (const unit of units) {
    // Strip control codes/placeholders so a token like \C[2] does not pollute words.
    const text = protectPlaceholders(unit.source).text.replace(/<PH_\d+>/g, " ");
    for (const match of text.matchAll(WORD_RE)) {
      const word = match[0];
      if (UPPERCASE_START_RE.test(word)) {
        capCounts.set(word, (capCounts.get(word) ?? 0) + 1);
      } else {
        lowerForms.add(word.toLowerCase());
      }
    }
  }

  const ranked = [...capCounts.entries()]
    .filter(([term, count]) => count >= minOccurrences && term.length >= 2 && !lowerForms.has(term.toLowerCase()))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const glossary: Glossary = {};
  for (const [term] of ranked) {
    glossary[term] = { mode: "keep" };
  }
  return glossary;
}

// Lint an existing glossary: structure (via the loader, which names the offending
// term) plus empties (an empty/whitespace term key) and case-insensitive
// duplicates (two keys differing only by case). Exits non-zero on any problem so a
// CI check can gate on it.
async function checkGlossary(args: string[], io: CliIO): Promise<number> {
  const glossaryPath = requirePositional(args, 1, "glossary path");
  let glossary: Glossary;
  try {
    glossary = await loadGlossary(glossaryPath);
  } catch (error: unknown) {
    io.stderr(`Invalid glossary: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  const terms = Object.keys(glossary);
  const problems: string[] = [];

  const empties = terms.filter((term) => term.trim().length === 0);
  if (empties.length > 0) {
    problems.push(`${empties.length} empty term key${empties.length === 1 ? "" : "s"}`);
  }

  const byLower = new Map<string, string[]>();
  for (const term of terms) {
    const key = term.toLowerCase();
    byLower.set(key, [...(byLower.get(key) ?? []), term]);
  }
  for (const group of byLower.values()) {
    if (group.length > 1) {
      problems.push(`terms differing only by case: ${group.join(", ")}`);
    }
  }

  if (problems.length > 0) {
    io.stderr(`Glossary '${glossaryPath}' has issues:\n${problems.map((problem) => `- ${problem}`).join("\n")}\n`);
    return 1;
  }

  io.stderr(`Glossary '${glossaryPath}' is valid: ${terms.length} term${terms.length === 1 ? "" : "s"}.\n`);
  return 0;
}
