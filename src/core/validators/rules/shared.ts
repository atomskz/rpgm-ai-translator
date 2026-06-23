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

import type { ValidationIssue } from "../../types.js";
import { protectPlaceholders } from "../../placeholders/index.js";

export function issue(
  id: string,
  severity: ValidationIssue["severity"],
  code: ValidationIssue["code"],
  message: string
): ValidationIssue {
  return { id, severity, code, message };
}

export function extractNumbers(text: string): string[] {
  return text.match(/\d+(?:[.,]\d+)?%?/g) ?? [];
}

// In-game numbers are the ones shown to the player as prose. Digits that belong
// to a control code, variable or placeholder (the 4 in `\C[4]`, the 1 in
// `\V[1]` or `<PH_1>`) are not in-game numbers, so strip every protected token
// before counting. Works whether the translation still holds `<PH_n>` tokens or
// has been restored to real control codes.
export function extractProseNumbers(text: string): string[] {
  const prose = protectPlaceholders(text).text.replace(/<PH_\d+>/g, " ");
  return extractNumbers(prose);
}

export function extractVariables(text: string): string[] {
  return text.match(/\\[VNP]\[\d+\]|\{[A-Za-z_][A-Za-z0-9_]*\}/g) ?? [];
}

export function extractTechnicalTokens(text: string): string[] {
  return text.match(/\\(?:[A-Za-z]+(?:\[[^\]\r\n]*\])?|\{|\}|\.|\||!|>)|%(?:\d+|(?:\.\d+)?[sdif])|\{[A-Za-z_][A-Za-z0-9_]*\}|<[^<>\n]+>/g) ?? [];
}

// Display width in message-box cells. RPG Maker renders full-width (CJK/kana,
// fullwidth forms, most emoji) glyphs as two cells, so `maxLength` is measured in
// cells, not UTF-16 code units. Iterating by code point also counts a surrogate
// pair (e.g. a rare kanji or emoji) as one glyph rather than two.
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    width += isWideCodePoint(char.codePointAt(0) ?? 0) ? 2 : 1;
  }
  return width;
}

function isWideCodePoint(codePoint: number): boolean {
  return (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f || // Hangul Jamo
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0x303e) || // CJK radicals, Kangxi, CJK symbols
      (codePoint >= 0x3041 && codePoint <= 0x33ff) || // Hiragana, Katakana, CJK symbols
      (codePoint >= 0x3400 && codePoint <= 0x4dbf) || // CJK Extension A
      (codePoint >= 0x4e00 && codePoint <= 0x9fff) || // CJK Unified Ideographs
      (codePoint >= 0xa000 && codePoint <= 0xa4cf) || // Yi
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) || // Hangul syllables
      (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK compatibility ideographs
      (codePoint >= 0xfe30 && codePoint <= 0xfe4f) || // CJK compatibility forms
      (codePoint >= 0xff00 && codePoint <= 0xff60) || // Fullwidth forms
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1f300 && codePoint <= 0x1faff) || // Emoji and symbols
      (codePoint >= 0x20000 && codePoint <= 0x3fffd)) // CJK Extension B and beyond
  );
}

export function sameMultiset(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const counts = new Map<string, number>();
  for (const item of left) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }

  for (const item of right) {
    const count = counts.get(item);
    if (!count) {
      return false;
    }
    if (count === 1) {
      counts.delete(item);
    } else {
      counts.set(item, count - 1);
    }
  }

  return counts.size === 0;
}
