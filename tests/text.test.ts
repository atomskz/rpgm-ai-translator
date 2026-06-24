import { describe, expect, it } from "vitest";
import { containsTranslatableLetter, glossaryTermMatches } from "../src/core/utils/text.js";

describe("glossaryTermMatches", () => {
  it("matches an alphabetic term only on word boundaries", () => {
    expect(glossaryTermMatches("Draw the Ko card", "Ko")).toBe(true);
    expect(glossaryTermMatches("a Kobold appears", "Ko")).toBe(false);
  });

  it("matches a CJK term as a substring (no word boundaries)", () => {
    expect(glossaryTermMatches("勇者アリアが現れた", "アリア")).toBe(true);
  });

  it("never matches an empty term", () => {
    expect(glossaryTermMatches("anything", "")).toBe(false);
  });

  it("escapes regex metacharacters in the term", () => {
    expect(glossaryTermMatches("cost is a.b today", "a.b")).toBe(true);
    expect(glossaryTermMatches("cost is axb today", "a.b")).toBe(false);
  });
});

describe("containsTranslatableLetter", () => {
  it("recognizes Latin, Cyrillic and CJK letters", () => {
    expect(containsTranslatableLetter("Hello")).toBe(true);
    expect(containsTranslatableLetter("Привет")).toBe(true);
    expect(containsTranslatableLetter("こんにちは")).toBe(true);
  });

  it("rejects digit/symbol-only strings", () => {
    expect(containsTranslatableLetter("123 + 45%")).toBe(false);
  });
});
