import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli/app.js";
import { createCliTempDir } from "./cli/helpers.js";

describe("CLI init", () => {
  it("scaffolds a config, .env.example and example glossary/character files", async () => {
    const root = await createCliTempDir("rpgm-cli-init-");
    const configPath = path.join(root, "rpgm-ai-translator.json");
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runCli(["init", "--out", configPath], {
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    expect(exitCode).toBe(0);
    const config = JSON.parse(await readFile(configPath, "utf8"));
    expect(config).toMatchObject({ provider: "deepseek", target: "ru", review: true, repair: true });

    const env = await readFile(path.join(root, ".env.example"), "utf8");
    // The key placeholder is scaffolded empty; a real key is never written.
    expect(env).toContain("DEEPSEEK_API_KEY=");
    expect(env).not.toMatch(/DEEPSEEK_API_KEY=\S/);

    // Example glossary/characters are copied as editable starting points.
    await expect(readFile(path.join(root, "glossary.json"), "utf8")).resolves.toContain("mode");
    await expect(readFile(path.join(root, "characters.json"), "utf8")).resolves.toContain("speechStyle");

    // stdout lists the created files; the next-step hint is on stderr.
    expect(stdout.join("")).toContain(configPath);
    expect(stderr.join("")).toContain("DEEPSEEK_API_KEY");
  });

  it("refuses to overwrite an existing config without --force, then overwrites with it", async () => {
    const root = await createCliTempDir("rpgm-cli-init-force-");
    const configPath = path.join(root, "rpgm-ai-translator.json");

    const first = await runCli(["init", "--out", configPath], { stdout: () => undefined, stderr: () => undefined });
    expect(first).toBe(0);

    const errors: string[] = [];
    const refused = await runCli(["init", "--out", configPath], {
      stdout: () => undefined,
      stderr: (text) => errors.push(text)
    });
    expect(refused).toBe(1);
    expect(errors.join("")).toContain("already exists");
    expect(errors.join("")).toContain("--force");

    const forced = await runCli(["init", "--out", configPath, "--force"], {
      stdout: () => undefined,
      stderr: () => undefined
    });
    expect(forced).toBe(0);
  });
});
