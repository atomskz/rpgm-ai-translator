import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli/app.js";
import { RpgMakerMvMzExtractor } from "../src/core/extractors/index.js";
import { translationCacheKey } from "../src/core/memory/index.js";
import type { MemoryEntry } from "../src/core/memory/index.js";
import { hashSource } from "../src/core/utils/hash.js";

async function seedBrokenProfileMemory(
  gamePath: string,
  memoryPath: string,
  source: string,
  translation: string
): Promise<void> {
  const units = await new RpgMakerMvMzExtractor().extract(gamePath);
  const profileUnit = units.find((unit) => unit.id === "Actors.1.profile");
  if (!profileUnit) {
    throw new Error("Test setup error: Actors.1.profile unit was not extracted");
  }
  const entry: MemoryEntry = {
    source,
    sourceHash: hashSource(source),
    cacheKey: translationCacheKey(profileUnit, { targetLanguage: "ru" }),
    targetLanguage: "ru",
    translation,
    category: "description",
    provider: "manual",
    model: "manual",
    status: "translated",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
  await writeFile(memoryPath, `${JSON.stringify(entry)}\n`, "utf8");
}

describe("run command", () => {
  it("runs the full mock pipeline and writes patch, report and memory files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-run-"));
    const gamePath = path.join(root, "game");
    const outDir = path.join(root, "out");
    await mkdir(path.join(gamePath, "data"), { recursive: true });
    await mkdir(path.join(gamePath, "js"), { recursive: true });
    await writeFile(path.join(gamePath, "js", "rpg_core.js"), "", "utf8");
    await writeJson(path.join(gamePath, "data", "Actors.json"), [
      null,
      {
        id: 1,
        name: "Aria",
        profile: String.raw`Hello \N[1].`
      }
    ]);

    const output: string[] = [];
    const exitCode = await runCli(["run", gamePath, "--provider", "mock", "--target", "ru", "--out", outDir], {
      stdout: (text) => output.push(text),
      stderr: () => undefined
    });

    const patchedActors = JSON.parse(await readFile(path.join(outDir, "data", "Actors.json"), "utf8"));
    const report = JSON.parse(await readFile(path.join(outDir, "report.json"), "utf8"));
    const units = JSON.parse(await readFile(path.join(outDir, "units.json"), "utf8"));
    const translations = JSON.parse(await readFile(path.join(outDir, "translations.json"), "utf8"));
    const memory = await readFile(path.join(outDir, "translation-memory.jsonl"), "utf8");

    expect(exitCode).toBe(0);
    expect(patchedActors[1].name).toBe("[ru] Aria");
    expect(patchedActors[1].profile).toBe(String.raw`[ru] Hello \N[1].`);
    expect(report).toMatchObject({
      engine: "rpgmaker-mv",
      unitsExtracted: 2,
      unitsTranslated: 2,
      failed: 0
    });
    expect(report.validationIssues).toEqual([]);
    expect(units).toHaveLength(2);
    expect(translations).toHaveLength(2);
    expect(memory.trim().split(/\n/)).toHaveLength(2);
    const stdout = output.join("");
    expect(stdout).toContain("Validating translations...");
    expect(stdout).toContain("Applying patch with 2/2 validation-safe translations...");
    expect(stdout).toContain("Writing report...");
    expect(stdout).toContain("Units translated: 2");
  });

  it("does not apply translations that have validation errors", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-run-invalid-"));
    const gamePath = path.join(root, "game");
    const outDir = path.join(root, "out");
    const memoryPath = path.join(root, "memory.jsonl");
    const sourceWithControlCode = String.raw`Hello \N[1].`;
    await mkdir(path.join(gamePath, "data"), { recursive: true });
    await mkdir(path.join(gamePath, "js"), { recursive: true });
    await writeFile(path.join(gamePath, "js", "rpg_core.js"), "", "utf8");
    await writeJson(path.join(gamePath, "data", "Actors.json"), [
      null,
      {
        id: 1,
        name: "Aria",
        profile: sourceWithControlCode
      }
    ]);
    await seedBrokenProfileMemory(gamePath, memoryPath, sourceWithControlCode, "[ru] Hello without placeholder.");

    const exitCode = await runCli(
      ["run", gamePath, "--provider", "mock", "--target", "ru", "--out", outDir, "--memory", memoryPath],
      {
        stdout: () => undefined,
        stderr: () => undefined
      }
    );

    const patchedActors = JSON.parse(await readFile(path.join(outDir, "data", "Actors.json"), "utf8"));
    const report = JSON.parse(await readFile(path.join(outDir, "report.json"), "utf8"));
    expect(exitCode).toBe(0);
    expect(patchedActors[1].name).toBe("[ru] Aria");
    expect(patchedActors[1].profile).toBe(sourceWithControlCode);
    expect(report.validationIssues).toContainEqual(
      expect.objectContaining({ id: "Actors.1.profile", severity: "error" })
    );
  });

  it("can repair validation issues before applying translations", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-run-repair-"));
    const gamePath = path.join(root, "game");
    const outDir = path.join(root, "out");
    const memoryPath = path.join(root, "memory.jsonl");
    const sourceWithControlCode = String.raw`Hello \N[1].`;
    await mkdir(path.join(gamePath, "data"), { recursive: true });
    await mkdir(path.join(gamePath, "js"), { recursive: true });
    await writeFile(path.join(gamePath, "js", "rpg_core.js"), "", "utf8");
    await writeJson(path.join(gamePath, "data", "Actors.json"), [
      null,
      {
        id: 1,
        name: "Aria",
        profile: sourceWithControlCode
      }
    ]);
    await seedBrokenProfileMemory(gamePath, memoryPath, sourceWithControlCode, "[ru] Hello without placeholder.");

    const output: string[] = [];
    const exitCode = await runCli(
      ["run", gamePath, "--provider", "mock", "--target", "ru", "--out", outDir, "--memory", memoryPath, "--repair"],
      {
        stdout: (text) => output.push(text),
        stderr: () => undefined
      }
    );

    const patchedActors = JSON.parse(await readFile(path.join(outDir, "data", "Actors.json"), "utf8"));
    const report = JSON.parse(await readFile(path.join(outDir, "report.json"), "utf8"));
    expect(exitCode).toBe(0);
    expect(output.join("")).toContain("Repair attempt 1/1: repaired 1");
    expect(patchedActors[1].profile).toBe(String.raw`[ru] Hello \N[1].`);
    expect(report.validationIssues).toEqual([]);
  });
});

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
