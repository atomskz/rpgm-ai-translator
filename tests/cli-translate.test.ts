import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli/app.js";
import { actorNameUnit, createCliTempDir, writeJsonFixture, writeJsonlFixture } from "./cli/helpers.js";

describe("CLI translate", () => {
  it("translates a units file with the mock provider", async () => {
    const root = await createCliTempDir("rpgm-cli-translate-");
    const unitsPath = path.join(root, "units.json");
    const outPath = path.join(root, "translations.json");
    await writeJsonFixture(unitsPath, [actorNameUnit()]);

    const exitCode = await runCli(["translate", unitsPath, "--provider", "mock", "--target", "ru", "--out", outPath], {
      stdout: () => undefined,
      stderr: () => undefined
    });

    const results = JSON.parse(await readFile(outPath, "utf8"));
    expect(exitCode).toBe(0);
    expect(results[0]).toMatchObject({
      id: "Actors.1.name",
      translation: "[ru] Aria",
      provider: "mock",
      status: "translated"
    });
  });

  it("rejects --provider none before writing a checkpoint", async () => {
    const root = await createCliTempDir("rpgm-cli-translate-none-");
    const unitsPath = path.join(root, "units.json");
    const outPath = path.join(root, "translations.json");
    const checkpointPath = path.join(root, "translations.jsonl");
    await writeJsonFixture(unitsPath, [actorNameUnit()]);

    const stderr: string[] = [];
    const exitCode = await runCli(["translate", unitsPath, "--provider", "none", "--out", outPath], {
      stdout: () => undefined,
      stderr: (text) => stderr.push(text)
    });

    expect(exitCode).toBe(1);
    expect(stderr.join("")).toContain("characters command");
    // The provider is validated before any checkpoint is written.
    await expect(readFile(checkpointPath, "utf8")).rejects.toThrow();
  });

  it("reads the units path when it follows options", async () => {
    const root = await createCliTempDir("rpgm-cli-translate-order-");
    const unitsPath = path.join(root, "units.json");
    const outPath = path.join(root, "translations.json");
    await writeJsonFixture(unitsPath, [actorNameUnit()]);

    const exitCode = await runCli(["translate", "--provider", "mock", "--target", "ru", unitsPath, "--out", outPath], {
      stdout: () => undefined,
      stderr: () => undefined
    });

    const results = JSON.parse(await readFile(outPath, "utf8"));
    expect(exitCode).toBe(0);
    expect(results[0]).toMatchObject({ id: "Actors.1.name", translation: "[ru] Aria" });
  });

  it("writes a default JSONL checkpoint while translating", async () => {
    const root = await createCliTempDir("rpgm-cli-translate-checkpoint-");
    const unitsPath = path.join(root, "units.json");
    const outPath = path.join(root, "translations.raw.json");
    const checkpointPath = path.join(root, "translations.raw.jsonl");
    await writeJsonFixture(unitsPath, [
      actorNameUnit({ hash: "hash-aria" }),
      actorNameUnit({
        id: "Actors.2.name",
        source: "Belffie",
        normalizedSource: "Belffie",
        jsonPath: "2.name",
        hash: "hash-belffie"
      })
    ]);

    const output: string[] = [];
    const exitCode = await runCli(
      ["translate", unitsPath, "--provider", "mock", "--target", "ru", "--batch-size", "1", "--out", outPath],
      {
        stdout: (text) => output.push(text),
        stderr: () => undefined
      }
    );

    const checkpointLines = (await readFile(checkpointPath, "utf8")).trim().split(/\r?\n/);
    const results = JSON.parse(await readFile(outPath, "utf8"));
    expect(exitCode).toBe(0);
    expect(output.join("")).toContain(`Writing checkpoint: ${checkpointPath}`);
    expect(output.join("")).toContain("Checkpoint saved: 1 results.");
    expect(checkpointLines).toHaveLength(2);
    expect(JSON.parse(checkpointLines[0])).toMatchObject({ id: "Actors.1.name", translation: "[ru] Aria" });
    expect(results).toHaveLength(2);
  });

  it("does not write a signature file for a derived checkpoint", async () => {
    const root = await createCliTempDir("rpgm-cli-derived-meta-");
    const unitsPath = path.join(root, "units.json");
    const outPath = path.join(root, "translations.json");
    await writeJsonFixture(unitsPath, [actorNameUnit()]);

    const exitCode = await runCli(["translate", unitsPath, "--provider", "mock", "--target", "ru", "--out", outPath], {
      stdout: () => undefined,
      stderr: () => undefined
    });

    expect(exitCode).toBe(0);
    // A derived checkpoint is reset every run and never resumed, so its signature
    // would be write-only; it must not be created.
    await expect(readFile(`${path.join(root, "translations.jsonl")}.meta.json`, "utf8")).rejects.toThrow();
  });

  it("resumes from an explicit JSONL checkpoint", async () => {
    const root = await createCliTempDir("rpgm-cli-translate-resume-");
    const unitsPath = path.join(root, "units.json");
    const outPath = path.join(root, "translations.raw.json");
    const checkpointPath = path.join(root, "checkpoint.jsonl");
    await writeJsonFixture(unitsPath, [
      actorNameUnit({ hash: "hash-aria" }),
      actorNameUnit({
        id: "Actors.2.name",
        source: "Belffie",
        normalizedSource: "Belffie",
        jsonPath: "2.name",
        hash: "hash-belffie"
      })
    ]);
    await writeJsonlFixture(checkpointPath, [
      {
        id: "Actors.1.name",
        source: "Aria",
        translation: "Ария из checkpoint",
        provider: "deepseek",
        model: "deepseek-v4-flash",
        status: "translated"
      }
    ]);

    const output: string[] = [];
    const exitCode = await runCli(
      [
        "translate",
        unitsPath,
        "--provider",
        "mock",
        "--target",
        "ru",
        "--batch-size",
        "1",
        "--checkpoint",
        checkpointPath,
        "--out",
        outPath
      ],
      {
        stdout: (text) => output.push(text),
        stderr: () => undefined
      }
    );

    const results = JSON.parse(await readFile(outPath, "utf8"));
    const checkpointLines = (await readFile(checkpointPath, "utf8")).trim().split(/\r?\n/);
    expect(exitCode).toBe(0);
    expect(output.join("")).toContain(`Loaded checkpoint: 1/2 translated units from ${checkpointPath}`);
    expect(results).toEqual([
      expect.objectContaining({
        id: "Actors.1.name",
        translation: "Ария из checkpoint",
        metadata: { fromCheckpoint: true }
      }),
      expect.objectContaining({
        id: "Actors.2.name",
        translation: "[ru] Belffie"
      })
    ]);
    expect(checkpointLines).toHaveLength(2);
  });

  it("uses translation memory from the translate command", async () => {
    const root = await createCliTempDir("rpgm-cli-memory-");
    const unitsPath = path.join(root, "units.json");
    const memoryPath = path.join(root, "memory.jsonl");
    const firstOut = path.join(root, "first.json");
    const secondOut = path.join(root, "second.json");
    await writeJsonFixture(unitsPath, [actorNameUnit({ hash: "hash-aria" })]);

    await runCli(["translate", unitsPath, "--provider", "mock", "--memory", memoryPath, "--out", firstOut], {
      stdout: () => undefined,
      stderr: () => undefined
    });
    const exitCode = await runCli(["translate", unitsPath, "--provider", "mock", "--memory", memoryPath, "--out", secondOut], {
      stdout: () => undefined,
      stderr: () => undefined
    });

    const results = JSON.parse(await readFile(secondOut, "utf8"));
    expect(exitCode).toBe(0);
    expect(results[0]).toMatchObject({
      translation: "[ru] Aria",
      metadata: { fromMemory: true }
    });
  });

  it("rejects an unknown provider with a clear usage error", async () => {
    const root = await createCliTempDir("rpgm-cli-provider-foo-");
    const unitsPath = path.join(root, "units.json");
    await writeJsonFixture(unitsPath, [actorNameUnit()]);
    const errors: string[] = [];

    const exitCode = await runCli(["translate", unitsPath, "--provider", "foo", "--out", path.join(root, "out.json")], {
      stdout: () => undefined,
      stderr: (text) => errors.push(text)
    });

    expect(exitCode).toBe(1);
    expect(errors.join("")).toContain("Unknown provider 'foo'");
  });

  it.each([
    ["--batch-size", "0", "positive integer"],
    ["--batch-size", "-1", "positive integer"],
    ["--batch-size", "1.5", "positive integer"],
    ["--temperature", "3", "less than or equal to 2"]
  ])("rejects invalid %s %s", async (flag, value, message) => {
    const root = await createCliTempDir("rpgm-cli-bad-number-");
    const unitsPath = path.join(root, "units.json");
    await writeJsonFixture(unitsPath, [actorNameUnit()]);
    const errors: string[] = [];

    const exitCode = await runCli(
      ["translate", unitsPath, "--provider", "mock", flag, value, "--out", path.join(root, "out.json")],
      { stdout: () => undefined, stderr: (text) => errors.push(text) }
    );

    expect(exitCode).toBe(1);
    expect(errors.join("")).toContain(message);
  });

  it("fails fast when deepseek is requested without DEEPSEEK_API_KEY", async () => {
    const originalKey = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    const root = await createCliTempDir("rpgm-cli-deepseek-key-");
    const unitsPath = path.join(root, "units.json");
    await writeJsonFixture(unitsPath, [actorNameUnit({ engine: "rpgmaker-mz", hash: "hash-aria" })]);
    const errors: string[] = [];

    try {
      const exitCode = await runCli(["translate", unitsPath, "--provider", "deepseek", "--out", path.join(root, "out.json")], {
        stdout: () => undefined,
        stderr: (text) => errors.push(text)
      });

      expect(exitCode).toBe(1);
      expect(errors.join("")).toContain("DEEPSEEK_API_KEY is required");
    } finally {
      if (originalKey == null) {
        delete process.env.DEEPSEEK_API_KEY;
      } else {
        process.env.DEEPSEEK_API_KEY = originalKey;
      }
    }
  });
});
