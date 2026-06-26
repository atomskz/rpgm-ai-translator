import { describe, expect, it } from "vitest";
import { displayWidth, extractNumbers } from "../src/core/validators/rules/shared.js";

// Built from explicit code points so the test does not depend on how the source
// file stores combining sequences (decomposed vs precomposed).
const COMBINING_ACUTE = String.fromCodePoint(0x0301);
const COMBINING_GRAVE = String.fromCodePoint(0x0300);
const COMBINING_CIRCUMFLEX = String.fromCodePoint(0x0302);

describe("displayWidth combining marks", () => {
  it("counts a combining diacritical mark as zero width", () => {
    // A decomposed accented letter (e + U+0301) renders the same single cell as the
    // precomposed form (U+00E9), so their widths must match.
    const decomposed = `caf${"e"}${COMBINING_ACUTE}`;
    const precomposed = `caf${String.fromCodePoint(0x00e9)}`;
    expect(displayWidth(decomposed)).toBe(4);
    expect(displayWidth(precomposed)).toBe(4);
    expect(displayWidth(decomposed)).toBe(displayWidth(precomposed));
  });

  it("counts stacked combining marks as zero width each", () => {
    // A base glyph plus three combining marks renders one cell wide.
    expect(displayWidth(`a${COMBINING_GRAVE}${COMBINING_ACUTE}${COMBINING_CIRCUMFLEX}`)).toBe(1);
  });

  it("does not over-count a combining-diacritic string against the base letters", () => {
    // Cyrillic "слово" (5 letters) with a combining stress mark on the third; the
    // mark adds 0, so the width is 5, not 6.
    const word = `${String.fromCodePoint(0x0441, 0x043b, 0x043e)}${COMBINING_ACUTE}${String.fromCodePoint(0x0432, 0x043e)}`;
    expect(displayWidth(word)).toBe(5);
  });
});

describe("displayWidth emoji, fullwidth and surrogate edges", () => {
  it("counts an emoji as two cells and once per surrogate pair", () => {
    expect(displayWidth(String.fromCodePoint(0x1f600))).toBe(2); // 😀
    // Two ASCII letters around one emoji: 1 + 2 + 1.
    expect(displayWidth(`a${String.fromCodePoint(0x1f600)}b`)).toBe(4);
  });

  it("counts an emoji variation selector as zero width", () => {
    const emoji = String.fromCodePoint(0x1f600); // 😀, already two cells wide
    expect(displayWidth(`${emoji}${String.fromCodePoint(0xfe0f)}`)).toBe(displayWidth(emoji));
    expect(displayWidth(`${emoji}${String.fromCodePoint(0xfe0f)}`)).toBe(2);
  });

  it("counts a fullwidth form as two cells and a halfwidth katakana as one", () => {
    expect(displayWidth(String.fromCodePoint(0xff15))).toBe(2); // fullwidth ５
    expect(displayWidth(String.fromCodePoint(0xff71))).toBe(1); // halfwidth katakana ｱ
  });

  it("counts a supplementary-plane CJK ideograph as one wide glyph", () => {
    expect(displayWidth(String.fromCodePoint(0x20000))).toBe(2); // CJK Ext. B
  });

  it("ignores a zero-width joiner between glyphs", () => {
    // man + ZWJ + woman: each emoji is two cells, the joiner adds zero.
    const seq = `${String.fromCodePoint(0x1f468)}${String.fromCodePoint(0x200d)}${String.fromCodePoint(0x1f469)}`;
    expect(displayWidth(seq)).toBe(4);
  });
});

describe("extractNumbers canonicalization edges", () => {
  it("reads a single grouping separator before three digits as grouping", () => {
    expect(extractNumbers("1,000")).toEqual(["1000"]);
    expect(extractNumbers("1.000")).toEqual(["1000"]);
    expect(extractNumbers("1,234,567")).toEqual(["1234567"]);
  });

  it("canonicalizes decimal separators alike (3.5 == 3,5)", () => {
    expect(extractNumbers("3.5")).toEqual(["3.5"]);
    expect(extractNumbers("3,5")).toEqual(["3.5"]);
  });

  it("treats a leading-dot decimal the same as a leading-zero decimal", () => {
    expect(extractNumbers(".5")).toEqual(extractNumbers("0.5"));
    expect(extractNumbers(".5")).toEqual(["0.5"]);
  });

  it("folds fullwidth digits and keeps a trailing percent", () => {
    expect(extractNumbers(String.fromCodePoint(0xff15, 0xff10, 0xff10))).toEqual(["500"]); // ５００
    expect(extractNumbers("100%")).toEqual(["100%"]);
  });

  it("does not read a digit inside an ellipsis run as a decimal", () => {
    // The '5' is a standalone number; the preceding dots are not a decimal point.
    expect(extractNumbers("Wait... 5 gold")).toEqual(["5"]);
  });

  it("strips a trailing fractional zero so 3.50 == 3.5", () => {
    expect(extractNumbers("3.50")).toEqual(["3.5"]);
  });
});
