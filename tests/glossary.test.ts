import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { loadGlossary } from "../src/config/public-api.js";
import { loadCharacterGlossary } from "../src/config/public-api.js";

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

  it("rejects an invalid glossary entry, naming the offending term", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-glossary-"));
    const glossaryPath = path.join(root, "glossary.json");
    await writeFile(glossaryPath, JSON.stringify({ Aria: { mode: "unknown" } }), "utf8");

    await expect(loadGlossary(glossaryPath)).rejects.toThrow(/glossary term 'Aria'.*'mode' must be one of/);
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

  it("rejects an invalid character entry, naming the offending name and field", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-characters-"));
    const charactersPath = path.join(root, "characters.json");
    await writeFile(charactersPath, JSON.stringify({ Aria: { gender: "robot" } }), "utf8");

    await expect(loadCharacterGlossary(charactersPath)).rejects.toThrow(/character 'Aria'.*'gender' must be one of/);
  });

  it("names the offending field for a non-string alias list", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-characters-"));
    const charactersPath = path.join(root, "characters.json");
    await writeFile(charactersPath, JSON.stringify({ Aria: { aliases: [1, 2] } }), "utf8");

    await expect(loadCharacterGlossary(charactersPath)).rejects.toThrow(/character 'Aria'.*'aliases' must be an array of strings/);
  });
});
