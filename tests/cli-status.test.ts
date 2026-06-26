import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli/app.js";
import { createCliTempDir } from "./cli/helpers.js";

async function makeGame(root: string): Promise<string> {
  const gamePath = path.join(root, "game");
  await mkdir(path.join(gamePath, "data"), { recursive: true });
  await mkdir(path.join(gamePath, "js"), { recursive: true });
  await writeFile(path.join(gamePath, "js", "rpg_core.js"), "", "utf8");
  await writeFile(path.join(gamePath, "data", "Actors.json"), JSON.stringify([null, { id: 1, name: "Aria" }]), "utf8");
  return gamePath;
}

describe("CLI status", () => {
  it("reports counts and a RESUME verdict for the same flags, RESET when a flag changes", async () => {
    const root = await createCliTempDir("rpgm-cli-status-");
    const gamePath = await makeGame(root);
    const outDir = path.join(root, "out");

    // Produce a work dir with checkpoints and a stored signature.
    const runExit = await runCli(["run", gamePath, "--provider", "mock", "--target", "ru", "--out", outDir], {
      stdout: () => undefined,
      stderr: () => undefined
    });
    expect(runExit).toBe(0);

    // Same flags -> would resume.
    const sameOut: string[] = [];
    const sameExit = await runCli(["status", gamePath, "--provider", "mock", "--target", "ru", "--out", outDir], {
      stdout: (text) => sameOut.push(text),
      stderr: () => undefined
    });
    const sameReport = JSON.parse(sameOut.join(""));
    expect(sameExit).toBe(0);
    expect(sameReport.units).toMatchObject({ total: 1, translated: 1 });
    expect(sameReport.resume).toContain("RESUME");

    // A different target -> would reset, naming the changed language.
    const changedOut: string[] = [];
    await runCli(["status", gamePath, "--provider", "mock", "--target", "en", "--out", outDir], {
      stdout: (text) => changedOut.push(text),
      stderr: () => undefined
    });
    const changedReport = JSON.parse(changedOut.join(""));
    expect(changedReport.resume).toContain("RESET");
    expect(changedReport.changedFields).toContain("targetLanguage");
  });

  it("reports an absent signature for a never-run work dir", async () => {
    const root = await createCliTempDir("rpgm-cli-status-fresh-");
    const gamePath = await makeGame(root);
    const outDir = path.join(root, "out");

    const stdout: string[] = [];
    const exitCode = await runCli(["status", gamePath, "--provider", "mock", "--target", "ru", "--out", outDir], {
      stdout: (text) => stdout.push(text),
      stderr: () => undefined
    });

    const report = JSON.parse(stdout.join(""));
    expect(exitCode).toBe(0);
    expect(report.units).toMatchObject({ translated: 0 });
    expect(report.resume).toContain("start fresh");
  });
});
