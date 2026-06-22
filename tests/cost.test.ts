import { describe, expect, it } from "vitest";
import { aggregateTokenUsage, estimateInputTokens, TokenBudget } from "../src/core/cost/index.js";
import type { TranslationResult, TranslationUnit } from "../src/core/types.js";

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

  it("enforces a token budget against estimates and accumulated usage", () => {
    const budget = new TokenBudget(50);
    expect(() => budget.assertEstimateWithin(80)).toThrow(/exceed the --max-tokens-budget of 50/);

    budget.record([withUsage("a", 30, 10)]);
    expect(budget.spentTokens).toBe(40);
    expect(() => budget.assertWithin()).not.toThrow();

    budget.record([withUsage("b", 15, 5)]);
    expect(() => budget.assertWithin()).toThrow(/Token budget of 50 exceeded/);
  });
});
