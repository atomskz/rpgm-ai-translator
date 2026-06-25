import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  appendTranslationResultsJsonlFile,
  normalizeTranslationResults,
  readTranslationResultsJsonlFile,
  readTranslationResultsFile,
  readTranslationUnitsFile,
  resetTranslationResultsJsonlFile,
  writeTranslationUnitsFile
} from "../src/core/translation-units.js";
import type { TranslationUnit } from "../src/core/types/public-api.js";

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

  it("loads a well-formed units file including placeholders and constraints", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-tu-load-"));
    const filePath = path.join(root, "units.json");
    const units = [
      {
        id: "Map001.events.1.pages.0.list.1.parameters.0",
        source: "Hello \\C[2]hero\\C[0]",
        normalizedSource: "Hello <PH_0>hero<PH_1>",
        filePath: "data/Map001.json",
        jsonPath: "events.1.pages.0.list.1.parameters.0",
        engine: "rpgmaker-mz",
        category: "dialogue",
        constraints: { maxLength: 52, maxLines: 1, preserveControlCodes: true },
        placeholders: [{ token: "<PH_0>", value: "\\C[2]", required: true, kind: "control-code" }],
        hash: "hash"
      }
    ];
    await writeFile(filePath, JSON.stringify(units), "utf8");

    await expect(readTranslationUnitsFile(filePath)).resolves.toEqual(units);
  });

  it("rejects a unit with an unknown category", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-tu-cat-"));
    const filePath = path.join(root, "units.json");
    await writeFile(
      filePath,
      JSON.stringify([
        { id: "a", source: "s", filePath: "f", jsonPath: "j", engine: "rpgmaker-mz", category: "garbage", hash: "h" }
      ]),
      "utf8"
    );

    await expect(readTranslationUnitsFile(filePath)).rejects.toThrow("Invalid translation unit at index 0");
  });

  it("rejects a unit whose maxLength constraint is a string", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-tu-maxlen-"));
    const filePath = path.join(root, "units.json");
    await writeFile(
      filePath,
      JSON.stringify([
        {
          id: "a",
          source: "s",
          filePath: "f",
          jsonPath: "j",
          engine: "rpgmaker-mz",
          category: "dialogue",
          constraints: { maxLength: "5" },
          hash: "h"
        }
      ]),
      "utf8"
    );

    await expect(readTranslationUnitsFile(filePath)).rejects.toThrow("Invalid translation unit at index 0");
  });

  it("rejects a unit with a malformed placeholder entry", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-tu-ph-"));
    const filePath = path.join(root, "units.json");
    await writeFile(
      filePath,
      JSON.stringify([
        {
          id: "a",
          source: "s",
          filePath: "f",
          jsonPath: "j",
          engine: "rpgmaker-mz",
          category: "dialogue",
          placeholders: [{ token: "<PH_0>", value: "x", required: true, kind: "made-up-kind" }],
          hash: "h"
        }
      ]),
      "utf8"
    );

    await expect(readTranslationUnitsFile(filePath)).rejects.toThrow("Invalid translation unit at index 0");
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
        model: "deepseek-v4-flash",
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
        model: "deepseek-v4-flash",
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

  it("does not glue a new record onto a truncated last line", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-tu-glue-"));
    const filePath = path.join(root, "translations.jsonl");

    await appendTranslationResultsJsonlFile(filePath, [
      { id: "Actors.1.name", source: "Aria", translation: "Ария", provider: "mock", model: "mock", status: "translated" }
    ]);
    // Simulate a crash mid-append leaving a final line without a newline.
    await writeFile(filePath, '{"id":"Actors.2.name","source":"Bel"', { encoding: "utf8", flag: "a" });

    await appendTranslationResultsJsonlFile(filePath, [
      { id: "Actors.3.name", source: "Cid", translation: "Сид", provider: "mock", model: "mock", status: "translated" }
    ]);

    const lines = (await readFile(filePath, "utf8")).split("\n").filter((line) => line.length > 0);
    // The truncated line stays its own (still-corrupt) line; the new record is not
    // concatenated onto it. Readers then recover the two intact records.
    expect(lines).toContain('{"id":"Actors.2.name","source":"Bel"');
    const recovered = await readTranslationResultsJsonlFile(filePath);
    expect(recovered.map((result) => result.id)).toEqual(["Actors.1.name", "Actors.3.name"]);
  });

  it("recovers readable checkpoint entries when the last line is truncated", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-tu-jsonl-recover-"));
    const filePath = path.join(root, "translations.jsonl");

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
    // Simulate a crash mid-append leaving a truncated final line.
    await writeFile(filePath, '{"id":"Actors.2.name","source":"Bel"', { encoding: "utf8", flag: "a" });

    expect(await readTranslationResultsJsonlFile(filePath)).toEqual([
      expect.objectContaining({ id: "Actors.1.name", translation: "Ария" })
    ]);
  });
});
