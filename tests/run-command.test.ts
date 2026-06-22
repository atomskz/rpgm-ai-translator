import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
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

    const workDir = `${outDir}-work`;
    const patchedActors = JSON.parse(await readFile(path.join(outDir, "data", "Actors.json"), "utf8"));
    const report = JSON.parse(await readFile(path.join(workDir, "report.json"), "utf8"));
    const units = JSON.parse(await readFile(path.join(workDir, "units.json"), "utf8"));
    const translations = JSON.parse(await readFile(path.join(workDir, "translations.json"), "utf8"));
    const memory = await readFile(path.join(workDir, "translation-memory.jsonl"), "utf8");

    expect(exitCode).toBe(0);
    expect(patchedActors[1].name).toBe("[ru] Aria");
    expect(patchedActors[1].profile).toBe(String.raw`[ru] Hello \N[1].`);
    // The patch directory holds only game files, not intermediate artifacts.
    expect((await readdir(outDir)).sort()).toEqual(["data"]);
    await expect(readFile(path.join(outDir, "report.json"), "utf8")).rejects.toThrow();
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

  it("refuses to run when the output directory is inside the game folder", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-run-unsafe-out-"));
    const gamePath = path.join(root, "game");
    const outDir = path.join(gamePath, "translated");
    await mkdir(path.join(gamePath, "data"), { recursive: true });
    await mkdir(path.join(gamePath, "js"), { recursive: true });
    await writeFile(path.join(gamePath, "js", "rpg_core.js"), "", "utf8");
    await writeJson(path.join(gamePath, "data", "Actors.json"), [null, { id: 1, name: "Aria" }]);

    const errors: string[] = [];
    const exitCode = await runCli(["run", gamePath, "--provider", "mock", "--target", "ru", "--out", outDir], {
      stdout: () => undefined,
      stderr: (text) => errors.push(text)
    });

    expect(exitCode).toBe(1);
    expect(errors.join("")).toContain("outside the game folder");
    await expect(readFile(path.join(gamePath, "units.json"), "utf8")).rejects.toThrow();
  });

  it("previews with --dry-run and writes nothing to the output directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-run-dry-"));
    const gamePath = path.join(root, "game");
    const outDir = path.join(root, "out");
    await mkdir(path.join(gamePath, "data"), { recursive: true });
    await mkdir(path.join(gamePath, "js"), { recursive: true });
    await writeFile(path.join(gamePath, "js", "rpg_core.js"), "", "utf8");
    await writeJson(path.join(gamePath, "data", "Actors.json"), [null, { id: 1, name: "Aria" }]);

    const output: string[] = [];
    const exitCode = await runCli(["run", gamePath, "--provider", "mock", "--target", "ru", "--out", outDir, "--dry-run"], {
      stdout: (text) => output.push(text),
      stderr: () => undefined
    });

    expect(exitCode).toBe(0);
    expect(output.join("")).toContain("[dry run]");
    expect(output.join("")).toContain("Would extract 1 units");
    await expect(readFile(path.join(outDir, "units.json"), "utf8")).rejects.toThrow();
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
    const report = JSON.parse(await readFile(path.join(`${outDir}-work`, "report.json"), "utf8"));
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
    const report = JSON.parse(await readFile(path.join(`${outDir}-work`, "report.json"), "utf8"));
    expect(exitCode).toBe(0);
    expect(output.join("")).toContain("Repair attempt 1/1: repaired 1");
    expect(patchedActors[1].profile).toBe(String.raw`[ru] Hello \N[1].`);
    expect(report.validationIssues).toEqual([]);
  });

  it("resumes translation and review from existing checkpoints without re-calling the provider", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-run-resume-"));
    const gamePath = path.join(root, "game");
    const outDir = path.join(root, "out");
    const workDir = `${outDir}-work`;
    await mkdir(path.join(gamePath, "data"), { recursive: true });
    await mkdir(path.join(gamePath, "js"), { recursive: true });
    await mkdir(workDir, { recursive: true });
    await writeFile(path.join(gamePath, "js", "rpg_core.js"), "", "utf8");
    await writeJson(path.join(gamePath, "data", "Map001.json"), {
      displayName: "Town",
      events: [null, { id: 1, name: "NPC", pages: [{ list: [{ code: 401, parameters: ["Hello."] }] }] }]
    });

    const dialogueId = "Map001.events.1.pages.0.list.0.parameters.0";
    await writeFile(
      path.join(workDir, "translations.raw.jsonl"),
      [
        JSON.stringify({ id: "Map001.displayName", source: "Town", translation: "Город", provider: "manual", model: "manual", status: "translated" }),
        JSON.stringify({ id: dialogueId, source: "Hello.", translation: "[ru] Hello.", provider: "manual", model: "manual", status: "translated" })
      ].join("\n") + "\n",
      "utf8"
    );
    await writeFile(
      path.join(workDir, "translations.reviewed.jsonl"),
      `${JSON.stringify({ id: dialogueId, source: "Hello.", translation: "Привет!", provider: "manual", model: "manual", status: "translated" })}\n`,
      "utf8"
    );

    const output: string[] = [];
    const exitCode = await runCli(["run", gamePath, "--provider", "mock", "--target", "ru", "--out", outDir, "--review"], {
      stdout: (text) => output.push(text),
      stderr: () => undefined
    });

    const patched = JSON.parse(await readFile(path.join(outDir, "data", "Map001.json"), "utf8"));
    const stdout = output.join("");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Resuming translation: 2/2");
    expect(stdout).toContain("Resuming review: 1/2");
    // Translation kept from the raw checkpoint, not re-translated to "[ru] Town".
    expect(patched.displayName).toBe("Город");
    // Review kept from the reviewed checkpoint, not re-reviewed back to the raw value.
    expect(patched.events[1].pages[0].list[0].parameters[0]).toBe("Привет!");
  });
});

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
