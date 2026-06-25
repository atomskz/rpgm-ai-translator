import { describe, expect, it } from "vitest";
import { aggregateTokenUsage, estimateInputTokens, TokenBudget } from "../src/core/cost.js";
import type { TranslationResult, TranslationUnit } from "../src/core/types/types.js";

function unit(source: string, normalizedSource?: string): TranslationUnit {
  return {
    id: source,
    source,
    normalizedSource,
    filePath: "data/Map001.json",
    jsonPath: "0",
    engine: "rpgmaker-mz",
    category: "dialogue",
    hash: "hash"
  };
}

function withUsage(id: string, inputTokens: number, outputTokens: number): TranslationResult {
  return {
    id,
    source: id,
    translation: id,
    provider: "deepseek",
    model: "m",
    status: "translated",
    metadata: { tokenUsage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens } }
  };
}

describe("cost estimation", () => {
  it("estimates input tokens from normalized source length plus per-unit overhead", () => {
    const estimate = estimateInputTokens([unit("12345678"), unit("raw", "1234")]);
    // 8/4 + 4/4 = 3 content tokens, plus 2 units * 16 overhead.
    expect(estimate).toBe(3 + 32);
  });

  it("aggregates token usage and returns undefined when none is present", () => {
    expect(aggregateTokenUsage([withUsage("a", 10, 5), withUsage("b", 20, 7)])).toEqual({
      inputTokens: 30,
      outputTokens: 12,
      totalTokens: 42,
      cachedInputTokens: 0
    });
    expect(
      aggregateTokenUsage([
        { id: "a", source: "a", translation: "a", provider: "mock", model: "m", status: "translated" }
      ])
    ).toBeUndefined();
  });

  it("counts a batch usage object once even when stamped on every result", () => {
    // A provider reports usage once per batch; the same object is shared across
    // each result. Summing per result would multiply the cost by the batch size.
    const usage = { inputTokens: 100, outputTokens: 40, totalTokens: 140 };
    const batch: TranslationResult[] = ["a", "b", "c"].map((id) => ({
      id,
      source: id,
      translation: id,
      provider: "deepseek",
      model: "m",
      status: "translated",
      metadata: { tokenUsage: usage }
    }));

    expect(aggregateTokenUsage(batch)).toEqual({
      inputTokens: 100,
      outputTokens: 40,
      totalTokens: 140,
      cachedInputTokens: 0
    });

    const budget = new TokenBudget(200);
    budget.record(batch);
    expect(budget.spentTokens).toBe(140);
    expect(() => budget.assertWithin()).not.toThrow();
  });

  it("enforces a token budget against estimates and accumulated usage", () => {
    const budget = new TokenBudget(50);
    expect(() => budget.assertEstimateWithin(80)).toThrow(/exceed the --max-tokens-budget of 50/);

    budget.record([withUsage("a", 30, 10)]);
    expect(budget.spentTokens).toBe(40);
    expect(() => budget.assertWithin()).not.toThrow();

    budget.record([withUsage("b", 15, 5)]);
    expect(() => budget.assertWithin()).toThrow(/Token budget of 50 exceeded/);
  });

  it("projects a later pass against tokens already spent", () => {
    const budget = new TokenBudget(100);
    budget.record([withUsage("a", 40, 20)]); // 60 tokens spent
    expect(budget.spentTokens).toBe(60);

    // 60 used + 30 estimated for the next pass = 90, within budget.
    expect(() => budget.assertProjectedWithin(30)).not.toThrow();
    // 60 used + 50 estimated = 110, so the pass is refused before it starts.
    expect(() => budget.assertProjectedWithin(50)).toThrow(/exceed the --max-tokens-budget of 100/);
  });
});
