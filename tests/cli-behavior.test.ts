import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli/app.js";
import { actorNameUnit, createCliTempDir, writeJsonFixture } from "./cli/helpers.js";

// Every command the dispatcher knows about, so the --help matrix stays in lockstep
// with app.ts: a new command without per-command help fails this test.
const COMMANDS = [
  "init",
  "doctor",
  "config",
  "memory",
  "report",
  "diff",
  "detect",
  "extract",
  "translate",
  "characters",
  "review",
  "validate",
  "repair",
  "apply",
  "patch-font",
  "run"
];

async function makeGame(prefix: string): Promise<string> {
  const root = await createCliTempDir(prefix);
  const gamePath = path.join(root, "game");
  await mkdir(path.join(gamePath, "data"), { recursive: true });
  await mkdir(path.join(gamePath, "js"), { recursive: true });
  await writeFile(path.join(gamePath, "js", "rpg_core.js"), "", "utf8");
  await writeFile(path.join(gamePath, "data", "Actors.json"), JSON.stringify([null, { id: 1, name: "Aria" }]), "utf8");
  return gamePath;
}

describe("CLI behavior — per-command help", () => {
  for (const command of COMMANDS) {
    it(`prints usage on '${command} --help' to stdout and exits 0`, async () => {
      const stdout: string[] = [];
      const stderr: string[] = [];
      const exitCode = await runCli([command, "--help"], {
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text)
      });

      expect(exitCode).toBe(0);
      // Help is a machine-and-human artifact printed to stdout; nothing on stderr.
      expect(stdout.join("")).toContain(`Usage: rpgm-ai-translator ${command}`);
      expect(stderr.join("")).toBe("");
    });
  }
});

describe("CLI behavior — exit codes", () => {
  it("exits 0 on a successful command", async () => {
    const gamePath = await makeGame("rpgm-cli-exit0-");
    const exitCode = await runCli(["detect", gamePath], { stdout: () => undefined, stderr: () => undefined });
    expect(exitCode).toBe(0);
  });

  it("exits 1 on an unknown command", async () => {
    const stderr: string[] = [];
    const exitCode = await runCli(["frobnicate"], { stdout: () => undefined, stderr: (text) => stderr.push(text) });
    expect(exitCode).toBe(1);
    expect(stderr.join("")).toContain("Unknown command");
  });

  it("exits 1 on a missing required argument", async () => {
    const stderr: string[] = [];
    const exitCode = await runCli(["translate"], { stdout: () => undefined, stderr: (text) => stderr.push(text) });
    expect(exitCode).toBe(1);
    expect(stderr.join("")).toContain("Missing units path");
  });

  it("exits 2 when validate finds apply-blocking errors", async () => {
    const root = await createCliTempDir("rpgm-cli-exit2-");
    const unitsPath = path.join(root, "units.json");
    const translationsPath = path.join(root, "translations.json");
    await writeJsonFixture(unitsPath, [actorNameUnit()]);
    // No translation for the unit -> MISSING_TRANSLATION (error severity).
    await writeJsonFixture(translationsPath, []);

    const exitCode = await runCli(["validate", unitsPath, translationsPath], {
      stdout: () => undefined,
      stderr: () => undefined
    });
    expect(exitCode).toBe(2);
  });
});

describe("CLI behavior — stream separation", () => {
  it("writes only the machine JSON payload to stdout for extract", async () => {
    const gamePath = await makeGame("rpgm-cli-streams-");
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runCli(["extract", gamePath], {
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    expect(exitCode).toBe(0);
    // stdout must parse as the units array with nothing human mixed in, so a
    // pipe (`extract ... > units.json`) captures a clean payload.
    const units = JSON.parse(stdout.join(""));
    expect(Array.isArray(units)).toBe(true);
    expect(units[0]).toMatchObject({ id: "Actors.1.name" });
  });
});

describe("CLI behavior — config precedence", () => {
  it("applies a config target, and a CLI --target overrides it", async () => {
    const gamePath = await makeGame("rpgm-cli-precedence-");
    const configPath = path.join(path.dirname(gamePath), "config.json");
    await writeFile(configPath, JSON.stringify({ target: "fr" }), "utf8");

    // Config supplies the target (so the echo shows fr, not the ru default).
    const fromConfig: string[] = [];
    await runCli(["run", gamePath, "--provider", "mock", "--out", path.join(path.dirname(gamePath), "out1"), "--dry-run", "--config", configPath], {
      stdout: () => undefined,
      stderr: (text) => fromConfig.push(text)
    });
    expect(fromConfig.join("")).toContain("Target language: fr");
    expect(fromConfig.join("")).not.toContain("(default)");

    // An explicit CLI flag wins over the config value.
    const fromCli: string[] = [];
    await runCli(
      ["run", gamePath, "--provider", "mock", "--target", "ja", "--out", path.join(path.dirname(gamePath), "out2"), "--dry-run", "--config", configPath],
      { stdout: () => undefined, stderr: (text) => fromCli.push(text) }
    );
    expect(fromCli.join("")).toContain("Target language: ja");
  });
});
