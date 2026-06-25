import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { JsonlTranslationMemory } from "../src/core/memory/jsonl.js";
import { translateWithMemory } from "../src/core/memory/translate.js";
import { hashSource } from "../src/core/utils/hash.js";
import type { LLMProvider, TranslateOptions, TranslationResult, TranslationUnit } from "../src/core/types/types.js";

describe("translation memory", () => {
  it("stores and retrieves JSONL entries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-memory-"));
    const memoryPath = path.join(root, "memory.jsonl");
    const memory = new JsonlTranslationMemory(memoryPath);

    await memory.upsert({
      source: "Aria",
      sourceHash: hashSource("Aria"),
      translation: "Ария",
      category: "name",
      provider: "mock",
      model: "mock",
      status: "translated",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });

    expect(await memory.get(hashSource("Aria"))).toMatchObject({
      source: "Aria",
      translation: "Ария"
    });
    expect(await readFile(memoryPath, "utf8")).toContain("\"source\":\"Aria\"");
  });

  it("upserts multiple entries while preserving existing creation timestamps", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-memory-batch-"));
    const memoryPath = path.join(root, "memory.jsonl");
    const memory = new JsonlTranslationMemory(memoryPath);
    const sourceHash = hashSource("Aria");

    await memory.upsert({
      source: "Aria",
      sourceHash,
      translation: "Ария",
      category: "name",
      provider: "mock",
      model: "mock",
      status: "translated",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    await memory.upsertMany([
      {
        source: "Aria",
        sourceHash,
        translation: "Ария!",
        category: "name",
        provider: "mock",
        model: "mock",
        status: "translated",
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z"
      },
      {
        source: "Luna",
        sourceHash: hashSource("Luna"),
        translation: "Луна",
        category: "name",
        provider: "mock",
        model: "mock",
        status: "translated",
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z"
      }
    ]);

    const aria = await memory.get(sourceHash);
    // The log is append-only: the superseded Aria line is kept on disk (3 physical
    // lines for 2 live entries) and resolved last-wins on read, rather than the
    // whole file being rewritten on every upsert.
    const rawLines = (await readFile(memoryPath, "utf8")).trim().split(/\n/);
    expect(rawLines).toHaveLength(3);
    expect(aria).toMatchObject({
      translation: "Ария!",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z"
    });
  });

  it("appends upserts and resolves the latest entry on a fresh read", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-memory-append-"));
    const memoryPath = path.join(root, "memory.jsonl");
    const writer = new JsonlTranslationMemory(memoryPath);
    const sourceHash = hashSource("Aria");

    for (const translation of ["Ария1", "Ария2", "Ария3"]) {
      await writer.upsert({
        source: "Aria",
        sourceHash,
        translation,
        category: "name",
        provider: "mock",
        model: "mock",
        status: "translated",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      });
    }

    const rawLines = (await readFile(memoryPath, "utf8")).trim().split(/\n/);
    expect(rawLines).toHaveLength(3);
    // A new instance must read the same last-wins value from the append-only log.
    const reader = new JsonlTranslationMemory(memoryPath);
    expect(await reader.get(sourceHash)).toMatchObject({ translation: "Ария3" });
  });

  it("compacts the log once it grows past the live entry count", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-memory-compact-"));
    const memoryPath = path.join(root, "memory.jsonl");
    const memory = new JsonlTranslationMemory(memoryPath, { compactionMinLines: 3, compactionGrowthFactor: 2 });
    const sourceHash = hashSource("Aria");

    for (const translation of ["v1", "v2", "v3", "v4"]) {
      await memory.upsert({
        source: "Aria",
        sourceHash,
        translation,
        category: "name",
        provider: "mock",
        model: "mock",
        status: "translated",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      });
    }

    const rawLines = (await readFile(memoryPath, "utf8")).trim().split(/\n/);
    expect(rawLines).toHaveLength(1);
    expect(await new JsonlTranslationMemory(memoryPath).get(sourceHash)).toMatchObject({ translation: "v4" });
  });

  it("persists memory atomically without leaving temporary files behind", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-memory-atomic-"));
    const memoryPath = path.join(root, "memory.jsonl");
    const memory = new JsonlTranslationMemory(memoryPath);

    await memory.upsert({
      source: "Aria",
      sourceHash: hashSource("Aria"),
      translation: "Ария",
      category: "name",
      provider: "mock",
      model: "mock",
      status: "translated",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });

    expect(await readdir(root)).toEqual(["memory.jsonl"]);
    expect(await memory.get(hashSource("Aria"))).toMatchObject({ translation: "Ария" });
  });

  it("skips corrupt lines instead of throwing when reading memory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-memory-corrupt-"));
    const memoryPath = path.join(root, "memory.jsonl");
    const valid = JSON.stringify({
      source: "Aria",
      sourceHash: hashSource("Aria"),
      translation: "Ария",
      category: "name",
      provider: "mock",
      model: "mock",
      status: "translated",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    // Second line is a truncated write, as a crash mid-write would leave.
    await writeFile(memoryPath, `${valid}\n{"source":"broken"`, "utf8");

    const memory = new JsonlTranslationMemory(memoryPath);

    expect(await memory.get(hashSource("Aria"))).toMatchObject({ translation: "Ария" });
  });

  it("uses memory hits and sends only unique misses to the provider", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-memory-"));
    const memory = new JsonlTranslationMemory(path.join(root, "memory.jsonl"));
    const provider = new CountingProvider();
    const units = [unit("Actors.1.name", "Aria"), unit("Actors.2.name", "Aria"), unit("Actors.3.name", "Luna")];

    const firstRun = await translateWithMemory(units, provider, { targetLanguage: "ru" }, memory);
    const secondRun = await translateWithMemory(units, provider, { targetLanguage: "ru" }, memory);

    expect(provider.calls).toEqual([["Actors.1.name", "Actors.3.name"]]);
    expect(firstRun.map((result) => result.translation)).toEqual(["[ru] Aria", "[ru] Aria", "[ru] Luna"]);
    expect(secondRun.every((result) => result.metadata?.fromMemory === true)).toBe(true);
  });

  it("does not reuse memory across target languages", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-memory-lang-"));
    const memory = new JsonlTranslationMemory(path.join(root, "memory.jsonl"));
    const provider = new CountingProvider();
    const units = [unit("Actors.1.name", "Aria")];

    const ru = await translateWithMemory(units, provider, { targetLanguage: "ru" }, memory);
    const fr = await translateWithMemory(units, provider, { targetLanguage: "fr" }, memory);

    expect(provider.calls).toEqual([["Actors.1.name"], ["Actors.1.name"]]);
    expect(ru[0].translation).toBe("[ru] Aria");
    expect(fr[0].translation).toBe("[fr] Aria");
    expect(fr[0].metadata?.fromMemory).not.toBe(true);
  });

  it("does not reuse memory across models", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-memory-model-"));
    const memory = new JsonlTranslationMemory(path.join(root, "memory.jsonl"));
    const provider = new CountingProvider();
    const units = [unit("Actors.1.name", "Aria")];

    await translateWithMemory(units, provider, { targetLanguage: "ru", model: "deepseek-v4-flash" }, memory);
    const upgraded = await translateWithMemory(units, provider, { targetLanguage: "ru", model: "deepseek-v4-pro" }, memory);

    expect(provider.calls).toEqual([["Actors.1.name"], ["Actors.1.name"]]);
    expect(upgraded[0].metadata?.fromMemory).not.toBe(true);
  });

  it("translates equal source strings with different constraints separately", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-memory-constraints-"));
    const memory = new JsonlTranslationMemory(path.join(root, "memory.jsonl"));
    const provider = new CountingProvider();
    const units: TranslationUnit[] = [
      { ...unit("Items.1.name", "Sword"), constraints: { maxLength: 8 } },
      { ...unit("Items.2.name", "Sword"), constraints: { maxLength: 24 } }
    ];

    await translateWithMemory(units, provider, { targetLanguage: "ru" }, memory);

    expect(provider.calls).toEqual([["Items.1.name", "Items.2.name"]]);
  });

  it("splits provider requests by batch size", async () => {
    const provider = new CountingProvider();
    const units = [unit("Actors.1.name", "Aria"), unit("Actors.2.name", "Luna"), unit("Actors.3.name", "Mira")];

    await translateWithMemory(units, provider, { targetLanguage: "ru", batchSize: 1 });

    expect(provider.calls).toEqual([["Actors.1.name"], ["Actors.2.name"], ["Actors.3.name"]]);
  });

  it("retries thrown provider batch failures at pipeline level", async () => {
    const provider = new FlakyProvider();

    const results = await translateWithMemory([unit("Actors.1.name", "Aria")], provider, {
      targetLanguage: "ru",
      retryAttempts: 1,
      retryDelayMs: 0
    });

    expect(provider.calls).toHaveLength(2);
    expect(results[0]).toMatchObject({
      id: "Actors.1.name",
      status: "translated",
      translation: "[ru] Aria"
    });
  });

  it("converts exhausted batch retries into per-unit failures", async () => {
    const provider = new AlwaysFailingProvider();

    const results = await translateWithMemory([unit("Actors.1.name", "Aria")], provider, {
      targetLanguage: "ru",
      retryAttempts: 1,
      retryDelayMs: 0
    });

    expect(provider.calls).toHaveLength(2);
    expect(results[0]).toMatchObject({
      id: "Actors.1.name",
      status: "failed",
      issues: [expect.objectContaining({ code: "MISSING_TRANSLATION" })]
    });
  });

  it("does not retry a non-retryable provider error", async () => {
    const provider = new AuthFailingProvider();

    const results = await translateWithMemory([unit("Actors.1.name", "Aria")], provider, {
      targetLanguage: "ru",
      retryAttempts: 3,
      retryDelayMs: 0
    });

    // A permanent error (bad key) is classified non-retryable, so it is tried
    // once and degraded rather than retried three times.
    expect(provider.calls).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: "Actors.1.name", status: "failed" });
  });
});

class CountingProvider implements LLMProvider {
  readonly name = "counting";
  readonly calls: string[][] = [];

  async translateBatch(batch: TranslationUnit[], options: TranslateOptions): Promise<TranslationResult[]> {
    this.calls.push(batch.map((unit) => unit.id));
    return batch.map((unit) => ({
      id: unit.id,
      source: unit.source,
      translation: `[${options.targetLanguage}] ${unit.normalizedSource ?? unit.source}`,
      provider: this.name,
      model: "counting",
      status: "translated"
    }));
  }
}

class FlakyProvider extends CountingProvider {
  override async translateBatch(batch: TranslationUnit[], options: TranslateOptions): Promise<TranslationResult[]> {
    this.calls.push(batch.map((unit) => unit.id));
    if (this.calls.length === 1) {
      throw new Error("temporary failure");
    }
    return batch.map((unit) => ({
      id: unit.id,
      source: unit.source,
      translation: `[${options.targetLanguage}] ${unit.normalizedSource ?? unit.source}`,
      provider: this.name,
      model: "counting",
      status: "translated"
    }));
  }
}

class AlwaysFailingProvider extends CountingProvider {
  override async translateBatch(batch: TranslationUnit[]): Promise<TranslationResult[]> {
    this.calls.push(batch.map((unit) => unit.id));
    throw new Error("permanent failure");
  }
}

class AuthFailingProvider extends CountingProvider {
  override async translateBatch(batch: TranslationUnit[]): Promise<TranslationResult[]> {
    this.calls.push(batch.map((unit) => unit.id));
    throw Object.assign(new Error("invalid api key"), { issueCode: "PROVIDER_AUTH_ERROR" });
  }
}

function unit(id: string, source: string): TranslationUnit {
  return {
    id,
    source,
    normalizedSource: source,
    filePath: "data/Actors.json",
    jsonPath: id === "Actors.1.name" ? "1.name" : "2.name",
    engine: "rpgmaker-mv",
    category: "name",
    hash: hashSource(source)
  };
}
