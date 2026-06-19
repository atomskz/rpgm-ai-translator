import { mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { JsonlTranslationMemory, translateWithMemory } from "../src/core/memory/index.js";
import { hashSource } from "../src/core/utils/hash.js";
import type { LLMProvider, TranslateOptions, TranslationResult, TranslationUnit } from "../src/core/types.js";

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
