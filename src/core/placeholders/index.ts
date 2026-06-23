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

import type { Placeholder } from "../types.js";

export type PlaceholderProtectionResult = {
  text: string;
  placeholders: Placeholder[];
};

// Backslash control codes. Besides the lettered codes (`\V[n]`, `\C[n]`, ...)
// and the punctuation codes, this also protects `\\` (escaped backslash), `\$`
// (gold window), `\<`/`\>` (instant-print toggle) and `\^` (skip wait at end of
// message). The `\\` alternative is listed first so a literal backslash is
// consumed before the lettered branch can misread the following text.
// The bracket sub-pattern allows one level of nesting (e.g. `\N[\V[1]]`) so a
// nested control code is captured whole instead of stopping at the first `]` and
// leaking a stray bracket into the translatable text.
const CONTROL_CODE_PATTERN = /\\(?:\\|[A-Za-z]+(?:\[(?:[^[\]\r\n]|\[[^[\]\r\n]*\])*\])?|\{|\}|\.|\||!|>|<|\$|\^)/g;
const FORMAT_TOKEN_PATTERN = /%(?:\d+|(?:\.\d+)?[sdif])/g;
const TEMPLATE_TOKEN_PATTERN = /\{[A-Za-z_][A-Za-z0-9_]*\}/g;
// Only treat `<...>` as a tag when it starts like one (optional slash then a
// letter), so prose such as `if a < b then c > d` is not swallowed as a tag.
const TAG_PATTERN = /<\/?[A-Za-z][^<>\n]*>/g;
const TOKEN_PATTERN = /<PH_\d+>/g;

type MatchKind = Placeholder["kind"];

type TokenMatch = {
  start: number;
  end: number;
  value: string;
  kind: MatchKind;
};

export function protectPlaceholders(source: string): PlaceholderProtectionResult {
  const matches = collectMatches(source);
  if (matches.length === 0) {
    return { text: source, placeholders: [] };
  }

  let cursor = 0;
  let text = "";
  const placeholders: Placeholder[] = [];

  matches.forEach((match, index) => {
    const token = `<PH_${index + 1}>`;
    text += source.slice(cursor, match.start);
    text += token;
    cursor = match.end;
    placeholders.push({
      token,
      value: match.value,
      required: true,
      kind: match.kind
    });
  });

  text += source.slice(cursor);
  return { text, placeholders };
}

export function restorePlaceholders(text: string, placeholders: Placeholder[] = []): string {
  if (placeholders.length === 0) {
    return text;
  }
  // Single pass over the token occurrences so a restored value that happens to
  // look like another token (e.g. source text that literally contained `<PH_2>`)
  // is not re-substituted by a later placeholder.
  const valueByToken = new Map(placeholders.map((placeholder) => [placeholder.token, placeholder.value]));
  return text.replace(TOKEN_PATTERN, (token) => valueByToken.get(token) ?? token);
}

/**
 * Restores placeholders to the text the message window actually draws. Control
 * codes (`\C[n]`, `\I[n]`, `\{`, `\.`, ...) are directives that render no glyphs,
 * so they are dropped rather than restored, while visible substitutions (format
 * and template tokens, tags) keep their value. Used to measure display width;
 * counting a control code's literal characters wrongly inflated the width of
 * every dialogue line. `\N[n]`/`\V[n]` expand to runtime values of unknown width
 * and are dropped too, so the measurement is a lower bound rather than a large
 * over-count.
 */
export function visibleText(text: string, placeholders: Placeholder[] = []): string {
  if (placeholders.length === 0) {
    return text;
  }
  const valueByToken = new Map(
    placeholders.map((placeholder) => [
      placeholder.token,
      placeholder.kind === "control-code" ? "" : placeholder.value
    ])
  );
  return text.replace(TOKEN_PATTERN, (token) => valueByToken.get(token) ?? token);
}

export function countToken(text: string, token: string): number {
  if (token.length === 0) {
    return 0;
  }
  return text.split(token).length - 1;
}

function collectMatches(source: string): TokenMatch[] {
  const rawMatches = [
    ...matchAll(source, CONTROL_CODE_PATTERN, "control-code"),
    ...matchAll(source, FORMAT_TOKEN_PATTERN, "format-token"),
    ...matchAll(source, TEMPLATE_TOKEN_PATTERN, "template-token"),
    ...matchAll(source, TAG_PATTERN, "tag")
  ].sort((a, b) => a.start - b.start || b.end - a.end);

  const matches: TokenMatch[] = [];
  let lastEnd = -1;
  for (const match of rawMatches) {
    if (match.start < lastEnd) {
      continue;
    }
    matches.push(match);
    lastEnd = match.end;
  }
  return matches;
}

function matchAll(source: string, pattern: RegExp, kind: MatchKind): TokenMatch[] {
  return Array.from(source.matchAll(pattern), (match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
    value: match[0],
    kind
  }));
}
