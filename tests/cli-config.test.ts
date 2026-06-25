import path from "node:path";
import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli/app.js";
import { createCliTempDir } from "./cli/helpers.js";

describe("CLI config", () => {
  it("validates a well-formed config and reports it valid", async () => {
    const root = await createCliTempDir("rpgm-cli-config-ok-");
    const configPath = path.join(root, "config.json");
    await writeFile(configPath, JSON.stringify({ provider: "deepseek", target: "ru" }), "utf8");

    const stdout: string[] = [];
    const exitCode = await runCli(["config", "validate", "--config", configPath], {
      stdout: (text) => stdout.push(text),
      stderr: () => undefined
    });

    expect(exitCode).toBe(0);
    expect(stdout.join("")).toContain("Config is valid");
  });

  it("exits non-zero on a malformed config and names the problem", async () => {
    const root = await createCliTempDir("rpgm-cli-config-bad-");
    const configPath = path.join(root, "config.json");
    await writeFile(configPath, "{not json", "utf8");

    const stderr: string[] = [];
    const exitCode = await runCli(["config", "validate", "--config", configPath], {
      stdout: () => undefined,
      stderr: (text) => stderr.push(text)
    });

    expect(exitCode).toBe(1);
    expect(stderr.join("")).toContain("Invalid config");
  });

  it("warns about an unknown key with a did-you-mean suggestion but still validates", async () => {
    const root = await createCliTempDir("rpgm-cli-config-typo-");
    const configPath = path.join(root, "config.json");
    await writeFile(configPath, JSON.stringify({ temprature: 0.3, target: "ru" }), "utf8");

    const stdout: string[] = [];
    const exitCode = await runCli(["config", "validate", "--config", configPath], {
      stdout: (text) => stdout.push(text),
      stderr: () => undefined
    });

    const out = stdout.join("");
    expect(exitCode).toBe(0);
    expect(out).toContain("Unknown config key 'temprature'");
    expect(out).toContain("Did you mean 'temperature'?");
    expect(out).toContain("Config is valid with 1 warning");
  });

  it("prints the flags config injects into a command, honoring the out scope", async () => {
    const root = await createCliTempDir("rpgm-cli-config-print-");
    const configPath = path.join(root, "config.json");
    await writeFile(configPath, JSON.stringify({ provider: "deepseek", target: "en", out: "./out/patch" }), "utf8");

    const runOut: string[] = [];
    const runExit = await runCli(["config", "print", "run", "--config", configPath], {
      stdout: (text) => runOut.push(text),
      stderr: () => undefined
    });
    expect(runExit).toBe(0);
    expect(runOut.join("")).toContain("--out ./out/patch");
    expect(runOut.join("")).toContain("--target en");

    const extractOut: string[] = [];
    await runCli(["config", "print", "extract", "--config", configPath], {
      stdout: (text) => extractOut.push(text),
      stderr: () => undefined
    });
    // out is scoped away from extract (CFG-01), so it must not appear there.
    expect(extractOut.join("")).not.toContain("--out");
  });

  it("rejects an unknown subcommand", async () => {
    const stderr: string[] = [];
    const exitCode = await runCli(["config", "frobnicate"], {
      stdout: () => undefined,
      stderr: (text) => stderr.push(text)
    });
    expect(exitCode).toBe(1);
    expect(stderr.join("")).toContain("config validate");
  });
});
