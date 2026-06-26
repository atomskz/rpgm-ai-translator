import { describe, expect, it } from "vitest";
import { displayWidth } from "../src/core/validators/rules/shared.js";

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
