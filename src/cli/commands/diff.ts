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

import { readTranslationResultsFile } from "../../core/translation-units.js";
import { writeFileAtomic } from "../../core/utils/fs.js";
import { readOption, readPositionals, requirePositional } from "../options/public-api.js";
import type { TranslationResult } from "../../core/types/public-api.js";
import type { CliIO } from "../types.js";

// Show per-unit before/after across the translate -> review -> repair passes, so a
// translator can see and trust what each pass changed. Reads the work-dir result
// files; writes a Markdown diff to --out or stdout. The third (repaired) file is
// optional, giving a two- or three-way comparison.
export async function diffCommand(args: string[], io: CliIO): Promise<number> {
  const rawPath = requirePositional(args, 0, "raw translations path");
  const reviewedPath = requirePositional(args, 1, "reviewed translations path");
  const repairedPath = readPositionals(args)[2];
  const out = readOption(args, "--out");

  const raw = await readTranslationResultsFile(rawPath);
  const reviewed = await readTranslationResultsFile(reviewedPath);
  const repaired = repairedPath ? await readTranslationResultsFile(repairedPath) : undefined;

  const markdown = buildDiffMarkdown(raw, reviewed, repaired);
  const payload = markdown.endsWith("\n") ? markdown : `${markdown}\n`;
  if (out) {
    await writeFileAtomic(out, payload);
    io.stderr(`Wrote diff: ${out}\n`);
  } else {
    io.stdout(payload);
  }
  return 0;
}

function inline(value: string): string {
  const collapsed = value.replace(/\r?\n/g, " ⏎ ").trim();
  return collapsed.length > 0 ? collapsed : "(empty)";
}

function buildDiffMarkdown(
  raw: TranslationResult[],
  reviewed: TranslationResult[],
  repaired?: TranslationResult[]
): string {
  const rawById = new Map(raw.map((result) => [result.id, result.translation]));
  const reviewedById = new Map(reviewed.map((result) => [result.id, result.translation]));
  const repairedById = repaired ? new Map(repaired.map((result) => [result.id, result.translation])) : undefined;

  const ids = [...new Set([...rawById.keys(), ...reviewedById.keys(), ...(repairedById?.keys() ?? [])])].sort();

  const sections: string[] = [];
  for (const id of ids) {
    const rawText = rawById.get(id);
    const reviewedText = reviewedById.get(id);
    const repairedText = repairedById?.get(id);

    const reviewChanged = reviewedText !== undefined && reviewedText !== rawText;
    const repairChanged = repairedById !== undefined && repairedText !== reviewedText;
    if (!reviewChanged && !repairChanged) {
      continue;
    }

    const lines = [`## ${id}`, `- raw: ${rawText === undefined ? "(absent)" : inline(rawText)}`];
    lines.push(`- reviewed: ${reviewChanged ? inline(reviewedText!) : "(unchanged)"}`);
    if (repairedById !== undefined) {
      lines.push(`- repaired: ${repairChanged ? inline(repairedText ?? "") : "(unchanged)"}`);
    }
    sections.push(lines.join("\n"));
  }

  const header = [
    "# Translation diff",
    "",
    `${sections.length} of ${ids.length} unit(s) changed across passes.`,
    ""
  ];
  if (sections.length === 0) {
    header.push("No translations changed between the supplied passes.");
    return header.join("\n");
  }
  return `${header.join("\n")}\n${sections.join("\n\n")}\n`;
}
