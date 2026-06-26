import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli/app.js";
import { createCliTempDir } from "./cli/helpers.js";

function entry(key: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    source: key,
    sourceHash: key,
    cacheKey: key,
    translation: `[ru] ${key}`,
    category: "name",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    status: "translated",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  });
}

async function seedMemory(file: string, lines: string[]): Promise<void> {
  await writeFile(file, `${lines.join("\n")}\n`, "utf8");
}

describe("CLI memory", () => {
  it("reports stats including superseded lines", async () => {
    const root = await createCliTempDir("rpgm-cli-memory-stats-");
    const file = path.join(root, "memory.jsonl");
    // Two physical lines for key "a" (one superseded) and one for "b" -> 2 live, 1 superseded.
    await seedMemory(file, [entry("a"), entry("a", { translation: "[ru] a2" }), entry("b")]);

    const stdout: string[] = [];
    const exitCode = await runCli(["memory", "stats", "--memory", file], {
      stdout: (text) => stdout.push(text),
      stderr: () => undefined
    });

    const stats = JSON.parse(stdout.join(""));
    expect(exitCode).toBe(0);
    expect(stats).toMatchObject({ liveEntries: 2, supersededLines: 1 });
  });

  it("compacts away superseded lines", async () => {
    const root = await createCliTempDir("rpgm-cli-memory-compact-");
    const file = path.join(root, "memory.jsonl");
    await seedMemory(file, [entry("a"), entry("a", { translation: "[ru] a2" }), entry("b")]);

    const exitCode = await runCli(["memory", "compact", "--memory", file], {
      stdout: () => undefined,
      stderr: () => undefined
    });

    const lines = (await readFile(file, "utf8")).trim().split(/\r?\n/);
    expect(exitCode).toBe(0);
    // Three physical lines collapse to two live entries.
    expect(lines).toHaveLength(2);
  });

  it("prunes entries matching a provider filter", async () => {
    const root = await createCliTempDir("rpgm-cli-memory-prune-");
    const file = path.join(root, "memory.jsonl");
    await seedMemory(file, [entry("a", { provider: "mock" }), entry("b", { provider: "deepseek" })]);

    const stderr: string[] = [];
    const exitCode = await runCli(["memory", "prune", "--memory", file, "--provider", "mock"], {
      stdout: () => undefined,
      stderr: (text) => stderr.push(text)
    });

    const lines = (await readFile(file, "utf8")).trim().split(/\r?\n/).filter(Boolean);
    expect(exitCode).toBe(0);
    expect(stderr.join("")).toContain("removed 1");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("deepseek");
  });

  it("refuses a filter-less prune", async () => {
    const root = await createCliTempDir("rpgm-cli-memory-prune-none-");
    const file = path.join(root, "memory.jsonl");
    await seedMemory(file, [entry("a")]);

    const stderr: string[] = [];
    const exitCode = await runCli(["memory", "prune", "--memory", file], {
      stdout: () => undefined,
      stderr: (text) => stderr.push(text)
    });

    expect(exitCode).toBe(1);
    expect(stderr.join("")).toContain("at least one filter");
    // The memory file is untouched.
    expect((await readFile(file, "utf8")).trim().split(/\r?\n/)).toHaveLength(1);
  });

  it("does not pull --provider/--model from project config (they are prune filters)", async () => {
    const root = await createCliTempDir("rpgm-cli-memory-config-");
    const file = path.join(root, "memory.jsonl");
    const configPath = path.join(root, "config.json");
    await seedMemory(file, [entry("a", { provider: "mock" }), entry("b", { provider: "deepseek" })]);
    await writeFile(configPath, JSON.stringify({ provider: "deepseek", model: "deepseek-v4-flash" }), "utf8");

    // With config provider=deepseek, a naive injection would narrow this prune;
    // memory ignores config, so --provider mock removes exactly the mock entry.
    const exitCode = await runCli(["memory", "prune", "--memory", file, "--provider", "mock", "--config", configPath], {
      stdout: () => undefined,
      stderr: () => undefined
    });

    const lines = (await readFile(file, "utf8")).trim().split(/\r?\n/).filter(Boolean);
    expect(exitCode).toBe(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("deepseek");
  });
});
