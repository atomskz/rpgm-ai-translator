import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli/app.js";
import { RpgMakerMvMzExtractor } from "../src/engines/rpgmaker-mvmz/extractor.js";
import { translationCacheKey } from "../src/core/memory/public-api.js";
import type { MemoryEntry } from "../src/core/memory/public-api.js";
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
      stderr: (text) => output.push(text)
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
      stderr: (text) => output.push(text)
    });

    expect(exitCode).toBe(0);
    expect(output.join("")).toContain("[dry run]");
    expect(output.join("")).toContain("Would extract 1 units");
    await expect(readFile(path.join(outDir, "units.json"), "utf8")).rejects.toThrow();
  });

  it("warns that run ignores --mode and --backup", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-run-mode-"));
    const gamePath = path.join(root, "game");
    const outDir = path.join(root, "out");
    await mkdir(path.join(gamePath, "data"), { recursive: true });
    await mkdir(path.join(gamePath, "js"), { recursive: true });
    await writeFile(path.join(gamePath, "js", "rpg_core.js"), "", "utf8");
    await writeJson(path.join(gamePath, "data", "Actors.json"), [null, { id: 1, name: "Aria" }]);

    const errors: string[] = [];
    const exitCode = await runCli(
      ["run", gamePath, "--provider", "mock", "--target", "ru", "--out", outDir, "--mode", "in-place", "--dry-run"],
      {
        stdout: () => undefined,
        stderr: (text) => errors.push(text)
      }
    );

    expect(exitCode).toBe(0);
    expect(errors.join("")).toContain("run always writes a patch; --mode and --backup are ignored.");
  });

  it("stops before calling the provider when the estimate exceeds --max-tokens-budget", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-run-budget-"));
    const gamePath = path.join(root, "game");
    const outDir = path.join(root, "out");
    await mkdir(path.join(gamePath, "data"), { recursive: true });
    await mkdir(path.join(gamePath, "js"), { recursive: true });
    await writeFile(path.join(gamePath, "js", "rpg_core.js"), "", "utf8");
    await writeJson(path.join(gamePath, "data", "Actors.json"), [null, { id: 1, name: "Aria", profile: "A wandering knight." }]);

    const errors: string[] = [];
    const exitCode = await runCli(["run", gamePath, "--provider", "mock", "--target", "ru", "--out", outDir, "--max-tokens-budget", "1"], {
      stdout: () => undefined,
      stderr: (text) => errors.push(text)
    });

    expect(exitCode).toBe(1);
    expect(errors.join("")).toContain("exceed the --max-tokens-budget of 1");
    // Nothing was written because the run stopped before extraction output.
    await expect(readFile(path.join(`${outDir}-work`, "units.json"), "utf8")).rejects.toThrow();
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
    // The broken profile translation is dropped from the patch and its blocking
    // error survives, so the run exits 2 while still applying the valid name.
    expect(exitCode).toBe(2);
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
        stderr: (text) => output.push(text)
      }
    );

    const patchedActors = JSON.parse(await readFile(path.join(outDir, "data", "Actors.json"), "utf8"));
    const report = JSON.parse(await readFile(path.join(`${outDir}-work`, "report.json"), "utf8"));
    expect(exitCode).toBe(0);
    expect(output.join("")).toContain("Repair attempt 1/1: repaired 1");
    expect(patchedActors[1].profile).toBe(String.raw`[ru] Hello \N[1].`);
    expect(report.validationIssues).toEqual([]);
  });

  it("resumes the repair budget instead of restarting it after a crash", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-run-repair-resume-"));
    const gamePath = path.join(root, "game");
    const outDir = path.join(root, "out");
    const workDir = `${outDir}-work`;
    const memoryPath = path.join(root, "memory.jsonl");
    const sourceWithControlCode = String.raw`Hello \N[1].`;
    await mkdir(path.join(gamePath, "data"), { recursive: true });
    await mkdir(path.join(gamePath, "js"), { recursive: true });
    await mkdir(workDir, { recursive: true });
    await writeFile(path.join(gamePath, "js", "rpg_core.js"), "", "utf8");
    await writeJson(path.join(gamePath, "data", "Actors.json"), [null, { id: 1, name: "Aria", profile: sourceWithControlCode }]);
    await seedBrokenProfileMemory(gamePath, memoryPath, sourceWithControlCode, "[ru] Hello without placeholder.");

    // Simulate a run that crashed after completing 1 of its 2 repair attempts.
    await writeFile(path.join(workDir, "repair-progress.json"), `${JSON.stringify({ attemptsCompleted: 1 })}\n`, "utf8");

    const output: string[] = [];
    const exitCode = await runCli(
      ["run", gamePath, "--provider", "mock", "--target", "ru", "--out", outDir, "--memory", memoryPath, "--repair", "--repair-attempts", "2"],
      { stdout: (text) => output.push(text), stderr: (text) => output.push(text) }
    );

    const stdout = output.join("");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 attempt(s) already completed");
    // Only the remaining attempt (2/2) runs; attempt 1 is not repeated.
    expect(stdout).toContain("Repair attempt 2/2");
    expect(stdout).not.toContain("attempt 1/2");
  });

  it("accepts --attempts as an alias for --repair-attempts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-run-repair-alias-"));
    const gamePath = path.join(root, "game");
    const outDir = path.join(root, "out");
    const memoryPath = path.join(root, "memory.jsonl");
    const sourceWithControlCode = String.raw`Hello \N[1].`;
    await mkdir(path.join(gamePath, "data"), { recursive: true });
    await mkdir(path.join(gamePath, "js"), { recursive: true });
    await writeFile(path.join(gamePath, "js", "rpg_core.js"), "", "utf8");
    await writeJson(path.join(gamePath, "data", "Actors.json"), [null, { id: 1, name: "Aria", profile: sourceWithControlCode }]);
    await seedBrokenProfileMemory(gamePath, memoryPath, sourceWithControlCode, "[ru] Hello without placeholder.");

    const output: string[] = [];
    const exitCode = await runCli(
      ["run", gamePath, "--provider", "mock", "--target", "ru", "--out", outDir, "--memory", memoryPath, "--repair", "--attempts", "2"],
      { stdout: (text) => output.push(text), stderr: (text) => output.push(text) }
    );

    // The alias mapped to --repair-attempts, so the progress shows two passes.
    expect(exitCode).toBe(0);
    expect(output.join("")).toContain("Repair attempt 1/2");
  });

  it("discards checkpoints when the target language changes between runs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-run-relang-"));
    const gamePath = path.join(root, "game");
    const outDir = path.join(root, "out");
    await mkdir(path.join(gamePath, "data"), { recursive: true });
    await mkdir(path.join(gamePath, "js"), { recursive: true });
    await writeFile(path.join(gamePath, "js", "rpg_core.js"), "", "utf8");
    await writeJson(path.join(gamePath, "data", "Map001.json"), {
      displayName: "Town",
      events: [null, { id: 1, name: "NPC", pages: [{ list: [{ code: 401, parameters: ["Hello."] }] }] }]
    });

    // First run translates into Russian and stamps the checkpoint with its signature.
    await runCli(["run", gamePath, "--provider", "mock", "--target", "ru", "--out", outDir], {
      stdout: () => undefined,
      stderr: () => undefined
    });

    // A second run into French must not resume the Russian checkpoint.
    const stderr: string[] = [];
    const exitCode = await runCli(["run", gamePath, "--provider", "mock", "--target", "fr", "--out", outDir], {
      stdout: () => undefined,
      stderr: (text) => stderr.push(text)
    });

    const patched = JSON.parse(await readFile(path.join(outDir, "data", "Map001.json"), "utf8"));
    expect(exitCode).toBe(0);
    expect(stderr.join("")).toContain("discarding stale checkpoints");
    expect(patched.displayName).toBe("[fr] Town");
    expect(patched.events[1].pages[0].list[0].parameters[0]).toBe("[fr] Hello.");
  });

  it("refuses, then with --force resets, a different game sharing --out", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-run-crossgame-"));
    const gameA = path.join(root, "gameA");
    const gameB = path.join(root, "gameB");
    const outDir = path.join(root, "out");
    for (const [game, line] of [
      [gameA, "Apple."],
      [gameB, "Banana."]
    ] as const) {
      await mkdir(path.join(game, "data"), { recursive: true });
      await mkdir(path.join(game, "js"), { recursive: true });
      await writeFile(path.join(game, "js", "rpg_core.js"), "", "utf8");
      await writeJson(path.join(game, "data", "Map001.json"), {
        displayName: "Town",
        events: [null, { id: 1, name: "NPC", pages: [{ list: [{ code: 401, parameters: [line] }] }] }]
      });
    }

    // First game stamps the work dir with its gameId and writes its patch.
    await runCli(["run", gameA, "--provider", "mock", "--target", "ru", "--out", outDir], {
      stdout: () => undefined,
      stderr: () => undefined
    });

    // A different game into the same, now-populated --out is refused so game A's
    // patch is not mixed with game B's sparse overlay.
    const refusalErr: string[] = [];
    const refused = await runCli(["run", gameB, "--provider", "mock", "--target", "ru", "--out", outDir], {
      stdout: () => undefined,
      stderr: (text) => refusalErr.push(text)
    });
    const afterRefusal = JSON.parse(await readFile(path.join(outDir, "data", "Map001.json"), "utf8"));
    expect(refused).toBe(1);
    expect(refusalErr.join("")).toContain("--force");
    expect(afterRefusal.events[1].pages[0].list[0].parameters[0]).toBe("[ru] Apple.");

    // With --force the work dir (checkpoints and default memory) is reset and game
    // B overwrites, with no residue from game A.
    const stderr: string[] = [];
    const exitCode = await runCli(["run", gameB, "--provider", "mock", "--target", "ru", "--out", outDir, "--force"], {
      stdout: () => undefined,
      stderr: (text) => stderr.push(text)
    });

    const patched = JSON.parse(await readFile(path.join(outDir, "data", "Map001.json"), "utf8"));
    const memory = await readFile(path.join(`${outDir}-work`, "translation-memory.jsonl"), "utf8");
    expect(exitCode).toBe(0);
    expect(stderr.join("")).toContain("different game");
    expect(patched.events[1].pages[0].list[0].parameters[0]).toBe("[ru] Banana.");
    expect(memory).toContain("Banana.");
    expect(memory).not.toContain("Apple.");
  });

  it("discards checkpoints when a sampling setting changes between runs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-run-inputs-"));
    const gamePath = path.join(root, "game");
    const outDir = path.join(root, "out");
    await mkdir(path.join(gamePath, "data"), { recursive: true });
    await mkdir(path.join(gamePath, "js"), { recursive: true });
    await writeFile(path.join(gamePath, "js", "rpg_core.js"), "", "utf8");
    await writeJson(path.join(gamePath, "data", "Map001.json"), {
      displayName: "Town",
      events: [null, { id: 1, name: "NPC", pages: [{ list: [{ code: 401, parameters: ["Hello."] }] }] }]
    });

    // First run stamps the signature at the default temperature.
    await runCli(["run", gamePath, "--provider", "mock", "--target", "ru", "--out", outDir], {
      stdout: () => undefined,
      stderr: () => undefined
    });

    // The same game/language but a different --temperature must not resume: the
    // units and their sources are unchanged, so only the widened signature catches it.
    const stderr: string[] = [];
    const exitCode = await runCli(
      ["run", gamePath, "--provider", "mock", "--target", "ru", "--out", outDir, "--temperature", "0.9"],
      { stdout: () => undefined, stderr: (text) => stderr.push(text) }
    );

    expect(exitCode).toBe(0);
    expect(stderr.join("")).toContain("discarding stale checkpoints");
  });

  it("estimates the token budget over unresumed units only", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-run-budget-"));
    const gamePath = path.join(root, "game");
    const outDir = path.join(root, "out");
    const workDir = `${outDir}-work`;
    await mkdir(path.join(gamePath, "data"), { recursive: true });
    await mkdir(path.join(gamePath, "js"), { recursive: true });
    await mkdir(workDir, { recursive: true });
    await writeFile(path.join(gamePath, "js", "rpg_core.js"), "", "utf8");
    const longLine = "The hero travels a very long and winding road through the dark forest at night.";
    await writeJson(path.join(gamePath, "data", "Map001.json"), {
      displayName: "Town",
      events: [null, { id: 1, name: "NPC", pages: [{ list: [{ code: 401, parameters: [longLine] }] }] }]
    });

    // Resume the long dialogue from the checkpoint, leaving only the short
    // displayName to translate. The full extraction would exceed the budget, but
    // the unresumed work fits, so the run must not be falsely blocked.
    const dialogueId = "Map001.events.1.pages.0.list.0.parameters.0";
    await writeFile(
      path.join(workDir, "translations.raw.jsonl"),
      `${JSON.stringify({ id: dialogueId, source: longLine, translation: "Длинная строка.", provider: "manual", model: "manual", status: "translated" })}\n`,
      "utf8"
    );

    const exitCode = await runCli(
      ["run", gamePath, "--provider", "mock", "--target", "ru", "--out", outDir, "--max-tokens-budget", "25"],
      { stdout: () => undefined, stderr: () => undefined }
    );

    const patched = JSON.parse(await readFile(path.join(outDir, "data", "Map001.json"), "utf8"));
    expect(exitCode).toBe(0);
    expect(patched.displayName).toBe("[ru] Town");
    expect(patched.events[1].pages[0].list[0].parameters[0]).toBe("Длинная строка.");
  });

  it("keeps event-comment translations when run with --include-comments", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-run-comments-"));
    const gamePath = path.join(root, "game");
    const outDir = path.join(root, "out");
    await mkdir(path.join(gamePath, "data"), { recursive: true });
    await mkdir(path.join(gamePath, "js"), { recursive: true });
    await writeFile(path.join(gamePath, "js", "rpg_core.js"), "", "utf8");
    await writeJson(path.join(gamePath, "data", "Map001.json"), {
      displayName: "Town",
      events: [
        null,
        {
          id: 1,
          name: "NPC",
          pages: [
            {
              list: [
                { code: 108, parameters: ["A developer note."] },
                { code: 401, parameters: ["Hello."] }
              ]
            }
          ]
        }
      ]
    });

    const exitCode = await runCli(
      ["run", gamePath, "--provider", "mock", "--target", "ru", "--out", outDir, "--include-comments"],
      { stdout: () => undefined, stderr: () => undefined }
    );

    const patched = JSON.parse(await readFile(path.join(outDir, "data", "Map001.json"), "utf8"));
    expect(exitCode).toBe(0);
    // Before the fix the apply step re-extracted without --include-comments, so the
    // comment translation had no matching unit and was silently skipped.
    expect(patched.events[1].pages[0].list[0].parameters[0]).toBe("[ru] A developer note.");
    expect(patched.events[1].pages[0].list[1].parameters[0]).toBe("[ru] Hello.");
  });

  it("exits 2 when a blocking validation error survives into the patch", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-run-residual-"));
    const gamePath = path.join(root, "game");
    const outDir = path.join(root, "out");
    const workDir = `${outDir}-work`;
    await mkdir(path.join(gamePath, "data"), { recursive: true });
    await mkdir(path.join(gamePath, "js"), { recursive: true });
    await mkdir(workDir, { recursive: true });
    await writeFile(path.join(gamePath, "js", "rpg_core.js"), "", "utf8");
    await writeJson(path.join(gamePath, "data", "Map001.json"), {
      events: [null, { id: 1, name: "NPC", pages: [{ list: [{ code: 401, parameters: ["Buy 5 apples."] }] }] }]
    });

    // Resume a translation that altered an in-game number (5 -> 7): a NUMBER_CHANGED
    // error survives validation, the unit is dropped from the patch, and the run
    // must signal the partial result with a non-zero exit.
    const dialogueId = "Map001.events.1.pages.0.list.0.parameters.0";
    await writeFile(
      path.join(workDir, "translations.raw.jsonl"),
      `${JSON.stringify({ id: dialogueId, source: "Buy 5 apples.", translation: "Купи 7 яблок.", provider: "manual", model: "manual", status: "translated" })}\n`,
      "utf8"
    );

    const errors: string[] = [];
    const exitCode = await runCli(
      ["run", gamePath, "--provider", "mock", "--target", "ru", "--out", outDir],
      { stdout: () => undefined, stderr: (text) => errors.push(text) }
    );

    expect(exitCode).toBe(2);
    expect(errors.join("")).toContain("blocking validation errors");
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
      stderr: (text) => output.push(text)
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
