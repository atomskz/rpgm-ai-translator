import { describe, expect, it } from "vitest";
import { protectPlaceholders, restorePlaceholders } from "../src/core/placeholders";

describe("placeholder protection", () => {
  it("protects and restores RPG Maker control codes and format tokens", () => {
    const source = String.raw`Hello, \N[1]! You received \I[64] Potion x%1 {value} <SomeTag>.`;

    const protectedText = protectPlaceholders(source);

    expect(protectedText.text).toBe("Hello, <PH_1>! You received <PH_2> Potion x<PH_3> <PH_4> <PH_5>.");
    expect(protectedText.placeholders.map((placeholder) => placeholder.value)).toEqual([
      String.raw`\N[1]`,
      String.raw`\I[64]`,
      "%1",
      "{value}",
      "<SomeTag>"
    ]);
    expect(restorePlaceholders(protectedText.text, protectedText.placeholders)).toBe(source);
  });

  it("protects all required RPG Maker and formatting placeholder forms", () => {
    const source = String.raw`\V[1] \N[3] \P[2] \G \C[4] \I[64] \MPD[Surprise] \{ \} \. \| \! \> %1 %s {value} <SomeTag>`;

    const protectedText = protectPlaceholders(source);

    expect(protectedText.text).toBe(
      "<PH_1> <PH_2> <PH_3> <PH_4> <PH_5> <PH_6> <PH_7> <PH_8> <PH_9> <PH_10> <PH_11> <PH_12> <PH_13> <PH_14> <PH_15> <PH_16> <PH_17>"
    );
    expect(protectedText.placeholders.map((placeholder) => placeholder.value)).toEqual([
      String.raw`\V[1]`,
      String.raw`\N[3]`,
      String.raw`\P[2]`,
      String.raw`\G`,
      String.raw`\C[4]`,
      String.raw`\I[64]`,
      String.raw`\MPD[Surprise]`,
      String.raw`\{`,
      String.raw`\}`,
      String.raw`\.`,
      String.raw`\|`,
      String.raw`\!`,
      String.raw`\>`,
      "%1",
      "%s",
      "{value}",
      "<SomeTag>"
    ]);
    expect(restorePlaceholders(protectedText.text, protectedText.placeholders)).toBe(source);
  });

  it("protects gold window, instant-print, skip-wait and escaped backslash codes", () => {
    const source = String.raw`\$ gold \< fast \^ skip \\ slash`;

    const protectedText = protectPlaceholders(source);

    expect(protectedText.placeholders.map((placeholder) => placeholder.value)).toEqual([
      String.raw`\$`,
      String.raw`\<`,
      String.raw`\^`,
      String.raw`\\`
    ]);
    expect(restorePlaceholders(protectedText.text, protectedText.placeholders)).toBe(source);
  });

  it("does not capture comparison prose as a tag", () => {
    const source = "if a < b then c > d";

    const protectedText = protectPlaceholders(source);

    expect(protectedText.placeholders).toEqual([]);
    expect(protectedText.text).toBe(source);
    expect(restorePlaceholders(protectedText.text, protectedText.placeholders)).toBe(source);
  });

  it("round-trips source that literally contains a placeholder-shaped token", () => {
    const source = String.raw`Set \V[1] then show <PH_2> literally`;

    const protectedText = protectPlaceholders(source);

    expect(protectedText.placeholders.map((placeholder) => placeholder.value)).toEqual([String.raw`\V[1]`, "<PH_2>"]);
    expect(restorePlaceholders(protectedText.text, protectedText.placeholders)).toBe(source);
  });

  it("protects a nested control code as a single token without leaking a bracket", () => {
    const source = String.raw`Name: \N[\V[1]]!`;

    const protectedText = protectPlaceholders(source);

    expect(protectedText.placeholders.map((placeholder) => placeholder.value)).toEqual([String.raw`\N[\V[1]]`]);
    expect(protectedText.text).toBe("Name: <PH_1>!");
    expect(restorePlaceholders(protectedText.text, protectedText.placeholders)).toBe(source);
  });

  it("treats an escaped backslash before a letter as a single token", () => {
    const source = String.raw`\\N[1]`;

    const protectedText = protectPlaceholders(source);

    expect(protectedText.placeholders.map((placeholder) => placeholder.value)).toEqual([String.raw`\\`]);
    expect(protectedText.text).toBe("<PH_1>N[1]");
    expect(restorePlaceholders(protectedText.text, protectedText.placeholders)).toBe(source);
  });
});
