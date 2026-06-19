import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  normalizeTranslationResults,
  readTranslationResultsFile,
  writeTranslationUnitsFile
} from "../src/core/translation-units/index.js";
import type { TranslationUnit } from "../src/core/types.js";

describe("translation unit import/export", () => {
  it("exports units as JSON", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-tu-export-"));
    const filePath = path.join(root, "units.json");
    const units: TranslationUnit[] = [
      {
        id: "Actors.1.name",
        source: "Aria",
        filePath: "data/Actors.json",
        jsonPath: "1.name",
        engine: "rpgmaker-mv",
        category: "name",
        hash: "hash"
      }
    ];

    await writeTranslationUnitsFile(filePath, units);

    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual(units);
  });

  it("imports manual translation JSON into full TranslationResult objects", async () => {
    const results = normalizeTranslationResults([
      {
        id: "Map001.events.1.pages.0.list.1.parameters.0",
        source: "Where are you going?",
        translation: "Куда ты идёшь?"
      }
    ]);

    expect(results).toEqual([
      {
        id: "Map001.events.1.pages.0.list.1.parameters.0",
        source: "Where are you going?",
        translation: "Куда ты идёшь?",
        provider: "manual-import",
        model: "manual",
        status: "translated"
      }
    ]);
  });

  it("reports invalid translation JSON clearly", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-tu-import-"));
    const filePath = path.join(root, "translations.json");
    await writeFile(filePath, "[", "utf8");

    await expect(readTranslationResultsFile(filePath)).rejects.toThrow("Invalid translations JSON");
  });

  it("reports invalid translation entries clearly", () => {
    expect(() => normalizeTranslationResults([{ id: "OnlyId" }])).toThrow(
      "Invalid translation entry at index 0"
    );
  });
});
