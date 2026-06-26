import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli/app.js";
import { createCliTempDir } from "./cli/helpers.js";

async function seedWorkDir(workDir: string): Promise<void> {
  await mkdir(workDir, { recursive: true });
  for (const name of [
    "translations.raw.jsonl",
    "translations.reviewed.jsonl",
    "checkpoint.meta.json",
    "repair-progress.json",
    "translation-memory.jsonl",
    ".rpgm-run.lock",
    "units.json"
  ]) {
    await writeFile(path.join(workDir, name), "x", "utf8");
  }
}

describe("CLI clean", () => {
  it("removes checkpoints and lock by default, preserving memory and units", async () => {
    const root = await createCliTempDir("rpgm-cli-clean-");
    const workDir = path.join(root, "out-work");
    await seedWorkDir(workDir);

    const exitCode = await runCli(["clean", "--out", path.join(root, "out")], {
      stdout: () => undefined,
      stderr: () => undefined
    });

    const remaining = (await readdir(workDir)).sort();
    expect(exitCode).toBe(0);
    expect(remaining).toContain("translation-memory.jsonl");
    expect(remaining).toContain("units.json");
    expect(remaining).not.toContain("translations.raw.jsonl");
    expect(remaining).not.toContain("checkpoint.meta.json");
    expect(remaining).not.toContain(".rpgm-run.lock");
  });

  it("--all also removes the translation memory", async () => {
    const root = await createCliTempDir("rpgm-cli-clean-all-");
    const workDir = path.join(root, "out-work");
    await seedWorkDir(workDir);

    await runCli(["clean", "--out", path.join(root, "out"), "--all"], { stdout: () => undefined, stderr: () => undefined });

    const remaining = await readdir(workDir);
    expect(remaining).not.toContain("translation-memory.jsonl");
    expect(remaining).toContain("units.json"); // never touched
  });

  it("--dry-run removes nothing", async () => {
    const root = await createCliTempDir("rpgm-cli-clean-dry-");
    const workDir = path.join(root, "out-work");
    await seedWorkDir(workDir);

    const stdout: string[] = [];
    const exitCode = await runCli(["clean", "--out", path.join(root, "out"), "--all", "--dry-run"], {
      stdout: (text) => stdout.push(text),
      stderr: () => undefined
    });

    const remaining = await readdir(workDir);
    expect(exitCode).toBe(0);
    expect(stdout.join("")).toContain("would remove");
    // Everything is still present after a dry run.
    expect(remaining).toContain("translations.raw.jsonl");
    expect(remaining).toContain("translation-memory.jsonl");
  });

  it("requires --out or --work-dir", async () => {
    const stderr: string[] = [];
    const exitCode = await runCli(["clean"], { stdout: () => undefined, stderr: (text) => stderr.push(text) });
    expect(exitCode).toBe(1);
    expect(stderr.join("")).toContain("--work-dir");
  });
});
