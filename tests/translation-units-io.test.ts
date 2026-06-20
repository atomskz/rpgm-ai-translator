import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  appendTranslationResultsJsonlFile,
  normalizeTranslationResults,
  readTranslationResultsJsonlFile,
  readTranslationResultsFile,
  resetTranslationResultsJsonlFile,
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

  it("preserves imported translation issues and metadata", () => {
    const results = normalizeTranslationResults([
      {
        id: "Actors.1.name",
        source: "Aria",
        translation: "Ария",
        provider: "deepseek",
        model: "deepseek-chat",
        status: "translated",
        issues: [
          {
            id: "Actors.1.name",
            severity: "warning",
            code: "UNCHANGED_TRANSLATION",
            message: "Needs review"
          }
        ],
        metadata: { fromCheckpoint: true, tokens: 42 }
      }
    ]);

    expect(results).toEqual([
      {
        id: "Actors.1.name",
        source: "Aria",
        translation: "Ария",
        provider: "deepseek",
        model: "deepseek-chat",
        status: "translated",
        issues: [
          {
            id: "Actors.1.name",
            severity: "warning",
            code: "UNCHANGED_TRANSLATION",
            message: "Needs review"
          }
        ],
        metadata: { fromCheckpoint: true, tokens: 42 }
      }
    ]);
  });

  it("rejects invalid typed translation metadata", () => {
    expect(() =>
      normalizeTranslationResults([
        {
          id: "Actors.1.name",
          source: "Aria",
          translation: "Ария",
          metadata: { reviewed: "yes" }
        }
      ])
    ).toThrow("Invalid translation entry at index 0");

    expect(() =>
      normalizeTranslationResults([
        {
          id: "Actors.1.name",
          source: "Aria",
          translation: "Ария",
          metadata: { usage: { total_tokens: "42" } }
        }
      ])
    ).toThrow("Invalid translation entry at index 0");
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

  it("appends and reads translation result JSONL checkpoints", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-tu-jsonl-"));
    const filePath = path.join(root, "translations.jsonl");

    await resetTranslationResultsJsonlFile(filePath);
    await appendTranslationResultsJsonlFile(filePath, [
      {
        id: "Actors.1.name",
        source: "Aria",
        translation: "Ария",
        provider: "mock",
        model: "mock",
        status: "translated"
      }
    ]);
    await appendTranslationResultsJsonlFile(filePath, [
      {
        id: "Actors.2.name",
        source: "Belffie",
        translation: "Белффи",
        provider: "mock",
        model: "mock",
        status: "translated"
      }
    ]);

    expect((await readFile(filePath, "utf8")).trim().split(/\r?\n/)).toHaveLength(2);
    expect(await readTranslationResultsJsonlFile(filePath)).toEqual([
      expect.objectContaining({ id: "Actors.1.name", translation: "Ария" }),
      expect.objectContaining({ id: "Actors.2.name", translation: "Белффи" })
    ]);
  });
});
