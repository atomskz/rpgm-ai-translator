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
const CONTROL_CODE_PATTERN = /\\(?:\\|[A-Za-z]+(?:\[[^\]\r\n]*\])?|\{|\}|\.|\||!|>|<|\$|\^)/g;
const FORMAT_TOKEN_PATTERN = /%(?:\d+|(?:\.\d+)?[sdif])/g;
const TEMPLATE_TOKEN_PATTERN = /\{[A-Za-z_][A-Za-z0-9_]*\}/g;
const TAG_PATTERN = /<[^<>\n]+>/g;

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
  return placeholders.reduce(
    (current, placeholder) => current.split(placeholder.token).join(placeholder.value),
    text
  );
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
