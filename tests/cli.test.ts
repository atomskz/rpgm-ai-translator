import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { runCli } from "../src/cli/app.js";

describe("CLI", () => {
  it("prints help for --help", async () => {
    const output: string[] = [];
    const errors: string[] = [];

    const exitCode = await runCli(["--help"], {
      stdout: (text) => output.push(text),
      stderr: (text) => errors.push(text)
    });

    expect(exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(output.join("")).toContain("rpgm-ai-translator detect ./game");
  });

  it("translates a units file with the mock provider", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-cli-translate-"));
    const unitsPath = path.join(root, "units.json");
    const outPath = path.join(root, "translations.json");
    await writeFile(
      unitsPath,
      `${JSON.stringify(
        [
          {
            id: "Actors.1.name",
            source: "Aria",
            normalizedSource: "Aria",
            filePath: "data/Actors.json",
            jsonPath: "1.name",
            engine: "rpgmaker-mv",
            category: "name",
            hash: "hash"
          }
        ],
        null,
        2
      )}\n`,
      "utf8"
    );

    const exitCode = await runCli(["translate", unitsPath, "--provider", "mock", "--target", "ru", "--out", outPath], {
      stdout: () => undefined,
      stderr: () => undefined
    });

    const results = JSON.parse(await readFile(outPath, "utf8"));
    expect(exitCode).toBe(0);
    expect(results[0]).toMatchObject({
      id: "Actors.1.name",
      translation: "[ru] Aria",
      provider: "mock",
      status: "translated"
    });
  });

  it("validates translations and writes a report", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-cli-validate-"));
    const unitsPath = path.join(root, "units.json");
    const translationsPath = path.join(root, "translations.json");
    const reportPath = path.join(root, "report.json");
    await writeFile(
      unitsPath,
      `${JSON.stringify(
        [
          {
            id: "Actors.1.name",
            source: "Aria",
            normalizedSource: "Aria",
            filePath: "data/Actors.json",
            jsonPath: "1.name",
            engine: "rpgmaker-mv",
            category: "name",
            hash: "hash"
          }
        ],
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeFile(
      translationsPath,
      `${JSON.stringify([{ id: "Unknown.1.name", source: "???", translation: "???" }], null, 2)}\n`,
      "utf8"
    );
    const output: string[] = [];

    const exitCode = await runCli(["validate", unitsPath, translationsPath, "--out", reportPath], {
      stdout: (text) => output.push(text),
      stderr: () => undefined
    });

    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(exitCode).toBe(0);
    expect(output.join("")).toContain("Validation issues: 2");
    expect(report.validationIssues.map((issue: { code: string }) => issue.code)).toEqual([
      "UNKNOWN_TRANSLATION_ID",
      "MISSING_TRANSLATION"
    ]);
  });

  it("uses glossary during validation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-cli-glossary-"));
    const unitsPath = path.join(root, "units.json");
    const translationsPath = path.join(root, "translations.json");
    const glossaryPath = path.join(root, "glossary.json");
    const reportPath = path.join(root, "report.json");
    await writeFile(
      unitsPath,
      `${JSON.stringify(
        [
          {
            id: "Actors.1.name",
            source: "Aria",
            normalizedSource: "Aria",
            filePath: "data/Actors.json",
            jsonPath: "1.name",
            engine: "rpgmaker-mv",
            category: "name",
            hash: "hash"
          }
        ],
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeFile(
      translationsPath,
      `${JSON.stringify([{ id: "Actors.1.name", source: "Aria", translation: "Ариа" }], null, 2)}\n`,
      "utf8"
    );
    await writeFile(glossaryPath, `${JSON.stringify({ Aria: { mode: "custom", translation: "Ария" } })}\n`, "utf8");

    const exitCode = await runCli(["validate", unitsPath, translationsPath, "--out", reportPath, "--glossary", glossaryPath], {
      stdout: () => undefined,
      stderr: () => undefined
    });

    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(exitCode).toBe(0);
    expect(report.validationIssues).toContainEqual(
      expect.objectContaining({ code: "GLOSSARY_VIOLATION" })
    );
  });

  it("uses translation memory from the translate command", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-cli-memory-"));
    const unitsPath = path.join(root, "units.json");
    const memoryPath = path.join(root, "memory.jsonl");
    const firstOut = path.join(root, "first.json");
    const secondOut = path.join(root, "second.json");
    await writeFile(
      unitsPath,
      `${JSON.stringify(
        [
          {
            id: "Actors.1.name",
            source: "Aria",
            normalizedSource: "Aria",
            filePath: "data/Actors.json",
            jsonPath: "1.name",
            engine: "rpgmaker-mv",
            category: "name",
            hash: "hash-aria"
          }
        ],
        null,
        2
      )}\n`,
      "utf8"
    );

    await runCli(["translate", unitsPath, "--provider", "mock", "--memory", memoryPath, "--out", firstOut], {
      stdout: () => undefined,
      stderr: () => undefined
    });
    const exitCode = await runCli(["translate", unitsPath, "--provider", "mock", "--memory", memoryPath, "--out", secondOut], {
      stdout: () => undefined,
      stderr: () => undefined
    });

    const results = JSON.parse(await readFile(secondOut, "utf8"));
    expect(exitCode).toBe(0);
    expect(results[0]).toMatchObject({
      translation: "[ru] Aria",
      metadata: { fromMemory: true }
    });
  });

  it("patches the MZ font settings into an existing patch directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-cli-font-"));
    const outDir = path.join(root, "out");
    const fontPath = path.join(root, "RusFont.ttf");
    await writeFile(fontPath, "fake-font", "utf8");
    await mkdir(path.join(root, "game", "data"), { recursive: true });
    await writeFile(
      path.join(root, "game", "data", "System.json"),
      `${JSON.stringify({ advanced: { mainFontFilename: "Old.woff", numberFontFilename: "OldBold.woff" } })}\n`,
      "utf8"
    );

    const exitCode = await runCli(["patch-font", path.join(root, "game"), "--out", outDir, "--font", fontPath], {
      stdout: () => undefined,
      stderr: () => undefined
    });

    const patchedSystem = JSON.parse(await readFile(path.join(outDir, "data", "System.json"), "utf8"));
    expect(exitCode).toBe(0);
    expect(await readFile(path.join(outDir, "fonts", "RusFont.ttf"), "utf8")).toBe("fake-font");
    expect(patchedSystem.advanced.mainFontFilename).toBe("RusFont.ttf");
    expect(patchedSystem.advanced.numberFontFilename).toBe("RusFont.ttf");
  });

  it("reviews a translations file with the mock provider", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-cli-review-"));
    const unitsPath = path.join(root, "units.json");
    const translationsPath = path.join(root, "translations.json");
    const outPath = path.join(root, "translations.reviewed.json");
    await writeFile(
      unitsPath,
      `${JSON.stringify(
        [
          {
            id: "Map001.events.1.pages.0.list.0.parameters.0",
            source: "I am ready.",
            normalizedSource: "I am ready.",
            filePath: "data/Map001.json",
            jsonPath: "events.1.pages.0.list.0.parameters.0",
            engine: "rpgmaker-mz",
            category: "dialogue",
            hash: "hash"
          }
        ],
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeFile(
      translationsPath,
      `${JSON.stringify(
        [
          {
            id: "Map001.events.1.pages.0.list.0.parameters.0",
            source: "I am ready.",
            translation: "Я готов.",
            provider: "deepseek",
            model: "deepseek-chat",
            status: "translated"
          }
        ],
        null,
        2
      )}\n`,
      "utf8"
    );
    const output: string[] = [];

    const exitCode = await runCli(
      ["review", unitsPath, translationsPath, "--provider", "mock", "--target", "ru", "--out", outPath],
      {
        stdout: (text) => output.push(text),
        stderr: () => undefined
      }
    );

    const reviewed = JSON.parse(await readFile(outPath, "utf8"));
    expect(exitCode).toBe(0);
    expect(output.join("")).toContain("Reviewing batch 1/1");
    expect(output.join("")).toContain("Completed review batch 1/1");
    expect(output.join("")).toContain("Reviewed: 1");
    expect(reviewed[0]).toMatchObject({
      id: "Map001.events.1.pages.0.list.0.parameters.0",
      translation: "Я готов.",
      metadata: { reviewed: true }
    });
  });

  it("generates a character glossary from units", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-cli-characters-"));
    const unitsPath = path.join(root, "units.json");
    const translationsPath = path.join(root, "translations.json");
    const outPath = path.join(root, "characters.json");
    await writeFile(
      unitsPath,
      `${JSON.stringify(
        [
          {
            id: "Actors.1.name",
            source: "Aria",
            filePath: "data/Actors.json",
            jsonPath: "1.name",
            engine: "rpgmaker-mz",
            category: "name",
            hash: "hash-aria"
          },
          {
            id: "Map001.events.1.pages.0.list.0.parameters.0",
            source: "I am ready.",
            filePath: "data/Map001.json",
            jsonPath: "events.1.pages.0.list.0.parameters.0",
            engine: "rpgmaker-mz",
            category: "dialogue",
            context: { speaker: "Aria" },
            hash: "hash-dialogue"
          }
        ],
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeFile(
      translationsPath,
      `${JSON.stringify(
        [
          {
            id: "Actors.1.name",
            source: "Aria",
            translation: "Ария",
            provider: "manual",
            model: "manual",
            status: "translated"
          }
        ],
        null,
        2
      )}\n`,
      "utf8"
    );
    const output: string[] = [];

    const exitCode = await runCli(
      ["characters", unitsPath, "--translations", translationsPath, "--provider", "mock", "--out", outPath],
      {
        stdout: (text) => output.push(text),
        stderr: () => undefined
      }
    );

    const characters = JSON.parse(await readFile(outPath, "utf8"));
    expect(exitCode).toBe(0);
    expect(output.join("")).toContain("Character candidates: 1");
    expect(characters).toEqual({
      Aria: expect.objectContaining({
        translation: "Ария",
        gender: "unknown",
        type: "person"
      })
    });
  });

  it("fails fast when deepseek is requested without DEEPSEEK_API_KEY", async () => {
    const originalKey = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-cli-deepseek-key-"));
    const unitsPath = path.join(root, "units.json");
    await writeFile(
      unitsPath,
      `${JSON.stringify(
        [
          {
            id: "Actors.1.name",
            source: "Aria",
            filePath: "data/Actors.json",
            jsonPath: "1.name",
            engine: "rpgmaker-mz",
            category: "name",
            hash: "hash-aria"
          }
        ],
        null,
        2
      )}\n`,
      "utf8"
    );
    const errors: string[] = [];

    try {
      const exitCode = await runCli(["translate", unitsPath, "--provider", "deepseek", "--out", path.join(root, "out.json")], {
        stdout: () => undefined,
        stderr: (text) => errors.push(text)
      });

      expect(exitCode).toBe(1);
      expect(errors.join("")).toContain("DEEPSEEK_API_KEY is required");
    } finally {
      if (originalKey == null) {
        delete process.env.DEEPSEEK_API_KEY;
      } else {
        process.env.DEEPSEEK_API_KEY = originalKey;
      }
    }
  });
});
