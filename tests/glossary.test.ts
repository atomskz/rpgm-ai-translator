import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { loadGlossary } from "../src/config/glossary.js";
import { loadCharacterGlossary } from "../src/config/characters.js";

describe("glossary loading", () => {
  it("loads valid glossary JSON", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-glossary-"));
    const glossaryPath = path.join(root, "glossary.json");
    await writeFile(
      glossaryPath,
      JSON.stringify({
        Aria: { mode: "custom", translation: "Ария" },
        Moonfall: { mode: "keep" }
      }),
      "utf8"
    );

    await expect(loadGlossary(glossaryPath)).resolves.toEqual({
      Aria: { mode: "custom", translation: "Ария" },
      Moonfall: { mode: "keep" }
    });
  });

  it("rejects invalid glossary shapes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-glossary-"));
    const glossaryPath = path.join(root, "glossary.json");
    await writeFile(glossaryPath, JSON.stringify({ Aria: { mode: "unknown" } }), "utf8");

    await expect(loadGlossary(glossaryPath)).rejects.toThrow("Glossary must be an object");
  });

  it("rejects a custom-mode term that has no translation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-glossary-"));
    const glossaryPath = path.join(root, "glossary.json");
    await writeFile(glossaryPath, JSON.stringify({ Sword: { mode: "custom" } }), "utf8");

    await expect(loadGlossary(glossaryPath)).rejects.toThrow("mode 'custom' but has no translation");
  });
});

describe("character glossary loading", () => {
  it("loads valid character metadata", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-characters-"));
    const charactersPath = path.join(root, "characters.json");
    await writeFile(
      charactersPath,
      JSON.stringify({
        Aria: { gender: "female", translation: "Ария", aliases: ["Ari"], speechStyle: "formal" }
      }),
      "utf8"
    );

    await expect(loadCharacterGlossary(charactersPath)).resolves.toEqual({
      Aria: { gender: "female", translation: "Ария", aliases: ["Ari"], speechStyle: "formal" }
    });
  });

  it("rejects invalid character metadata", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-characters-"));
    const charactersPath = path.join(root, "characters.json");
    await writeFile(charactersPath, JSON.stringify({ Aria: { gender: "robot" } }), "utf8");

    await expect(loadCharacterGlossary(charactersPath)).rejects.toThrow("Character glossary must be an object");
  });
});
