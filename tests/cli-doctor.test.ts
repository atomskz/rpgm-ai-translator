import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli/app.js";
import { createCliTempDir } from "./cli/helpers.js";

describe("CLI doctor", () => {
  const savedKey = process.env.DEEPSEEK_API_KEY;

  beforeEach(() => {
    delete process.env.DEEPSEEK_API_KEY;
  });
  afterEach(() => {
    if (savedKey === undefined) {
      delete process.env.DEEPSEEK_API_KEY;
    } else {
      process.env.DEEPSEEK_API_KEY = savedKey;
    }
  });

  it("passes every check for the mock provider against a real game", async () => {
    const root = await createCliTempDir("rpgm-cli-doctor-ok-");
    const gamePath = path.join(root, "game");
    await mkdir(path.join(gamePath, "data"), { recursive: true });
    await mkdir(path.join(gamePath, "js"), { recursive: true });
    await writeFile(path.join(gamePath, "js", "rpg_core.js"), "", "utf8");
    await writeFile(path.join(gamePath, "data", "Actors.json"), JSON.stringify([null, { id: 1, name: "Aria" }]), "utf8");

    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runCli(["doctor", gamePath, "--provider", "mock"], {
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    const out = stdout.join("");
    expect(exitCode).toBe(0);
    expect(out).toContain("PASS  Provider 'mock' is supported");
    expect(out).toContain("Detected rpgmaker-mv");
    expect(out).toContain("PASS  Provider responds to a probe request");
    expect(out).not.toContain("FAIL");
    expect(stderr.join("")).toContain("All preflight checks passed");
  });

  it("fails the API-key check and skips the probe for deepseek without a key", async () => {
    const stdout: string[] = [];
    const exitCode = await runCli(["doctor", "--provider", "deepseek"], {
      stdout: (text) => stdout.push(text),
      stderr: () => undefined
    });

    const out = stdout.join("");
    expect(exitCode).toBe(1);
    expect(out).toContain("FAIL  DEEPSEEK_API_KEY is set");
    // The probe must be skipped (not attempted) when there is no key to probe with.
    expect(out).toContain("Skipped");
  });

  it("fails the game check for a directory that is not an RPG Maker project", async () => {
    const root = await createCliTempDir("rpgm-cli-doctor-nogame-");
    const stdout: string[] = [];
    const exitCode = await runCli(["doctor", root, "--provider", "mock"], {
      stdout: (text) => stdout.push(text),
      stderr: () => undefined
    });

    const out = stdout.join("");
    // The probe still passes (mock), but the unknown engine fails the run.
    expect(exitCode).toBe(1);
    expect(out).toContain("FAIL");
    expect(out).toContain("recognized RPG Maker project");
    expect(out).toContain("PASS  Provider responds to a probe request");
  });
});
