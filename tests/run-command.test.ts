import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli/app.js";
import { hashSource } from "../src/core/utils/hash.js";

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
    expect(output.join("")).toContain("Units translated: 2");
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
    await writeFile(
      memoryPath,
      `${JSON.stringify({
        source: sourceWithControlCode,
        sourceHash: hashSource(sourceWithControlCode),
        translation: "[ru] Hello without placeholder.",
        category: "description",
        provider: "manual",
        model: "manual",
        status: "translated",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      })}\n`,
      "utf8"
    );

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
});

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
