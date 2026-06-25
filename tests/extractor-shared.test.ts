import { describe, expect, it } from "vitest";
import { isSafeRuntimeText } from "../src/engines/rpgmaker-mvmz/extract/shared.js";

describe("isSafeRuntimeText", () => {
  it("treats asset paths with spaces or backslashes as non-translatable", () => {
    expect(isSafeRuntimeText("img\\face 1.png")).toBe(false);
    expect(isSafeRuntimeText("audio/bgm 02.ogg")).toBe(false);
    expect(isSafeRuntimeText("Actor1.png")).toBe(false);
  });

  it("keeps real dialogue translatable", () => {
    expect(isSafeRuntimeText("Hello, traveller.")).toBe(true);
    expect(isSafeRuntimeText("こんにちは")).toBe(true);
  });

  it("filters engine tokens, booleans and blank values", () => {
    expect(isSafeRuntimeText("$gameParty.gold")).toBe(false);
    expect(isSafeRuntimeText("true")).toBe(false);
    expect(isSafeRuntimeText("   ")).toBe(false);
  });
});
