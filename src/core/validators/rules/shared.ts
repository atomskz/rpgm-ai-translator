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
  // Fold full-width digits and separators (５００ -> 500, ， -> ,, ％ -> %) so a
  // locale's formatting is not mistaken for a changed number, then reduce each
  // match to a canonical value. The second alternative also accepts a decimal with
  // no leading zero (.5 / ,5) — but only when it does not follow an ellipsis or
  // another digit — so `0.5` and `.5` canonicalize alike instead of reading as
  // 0.5 vs 5.
  const normalized = text.normalize("NFKC");
  const matches = normalized.match(/(?:\d+(?:[.,\u00A0\u202F]\d+)*|(?<![.,\d])[.,]\d+)%?/g) ?? [];
  return matches.map(canonicalizeNumber);
}

// Reduce a formatted number to a locale-independent canonical form so grouping and
// decimal-separator differences (1,000 vs 1000, 3.5 vs 3,5) compare equal while a
// real value change (100 vs 200) does not. A single separator before exactly three
// digits is read as grouping (the common 1,000 = 1000 case in game text) rather
// than a three-decimal number.
function canonicalizeNumber(token: string): string {
  const percent = token.endsWith("%") ? "%" : "";
  const body = (percent ? token.slice(0, -1) : token).replace(/[\u00A0\u202F]/g, "");
  const lastDot = body.lastIndexOf(".");
  const lastComma = body.lastIndexOf(",");
  let decimalIndex = -1;
  if (lastDot >= 0 && lastComma >= 0) {
    decimalIndex = Math.max(lastDot, lastComma);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const separatorIndex = Math.max(lastDot, lastComma);
    const separator = body[separatorIndex];
    const separatorCount = body.split(separator).length - 1;
    const trailingDigits = body.length - separatorIndex - 1;
    if (separatorCount === 1 && trailingDigits !== 3) {
      decimalIndex = separatorIndex;
    }
  }
  const intRaw = (decimalIndex >= 0 ? body.slice(0, decimalIndex) : body).replace(/[.,]/g, "");
  const fracRaw = decimalIndex >= 0 ? body.slice(decimalIndex + 1).replace(/[.,]/g, "") : "";
  const intPart = intRaw.replace(/^0+(?=\d)/, "") || "0";
  const fracPart = fracRaw.replace(/0+$/, "");
  return `${intPart}${fracPart ? `.${fracPart}` : ""}${percent}`;
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
  // `<PH_n>` is our internal placeholder sentinel, not a game token. A residual one
  // (a model hallucination) is reported as EXTRA_PLACEHOLDER; strip it here so it
  // does not also pollute the technical-token multiset and mask itself as a
  // TECHNICAL_TOKEN_CHANGED. Source text never contains it, so this stays symmetric.
  const withoutSentinels = text.replace(/<PH_\d+>/g, " ");
  // Reuse the placeholder protector's tokenizer so the recognised control codes and
  // tags stay identical to what gets protected/restored. The previous bespoke regex
  // had drifted: it swallowed prose comparisons such as `HP < 50 and MP > 20` as a
  // tag, and it missed `\\`, `\<`, `\$` and `\^` that the protector handles.
  return protectPlaceholders(withoutSentinels).placeholders.map((placeholder) => placeholder.value);
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
