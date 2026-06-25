import { describe, expect, it } from "vitest";
import { aggregateTokenUsage, estimateInputTokens, estimateTotalTokens, TokenBudget } from "../src/core/cost.js";
import type { TranslationResult, TranslationUnit } from "../src/core/types/public-api.js";

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

  it("estimates total tokens above the input-only estimate and as zero for no units", () => {
    const units = [unit("A wandering knight roams the moonlit road."), unit("The castle gates are sealed.")];
    const total = estimateTotalTokens(units);
    // Total folds in the per-batch system prompt and an output multiplier, so it
    // must sit above the source-only input estimate it is built from.
    expect(total).toBeGreaterThan(estimateInputTokens(units));
    expect(estimateTotalTokens([])).toBe(0);
  });

  it("keeps the total estimate within a sane factor of recorded usage", () => {
    // A realistic batch: ~60 short dialogue lines. The estimate must land in the
    // same order of magnitude as the provider's recorded total, so the budget
    // guard is meaningful instead of undershooting by a large multiplier.
    const units = Array.from({ length: 60 }, (_, index) => unit(`Dialogue line number ${index} in the scene.`));
    const estimate = estimateTotalTokens(units, { batchSize: 20 });
    // Stand-in for a provider that reported ~9000 total tokens across the run.
    const recordedTotal = 9000;
    const ratio = estimate / recordedTotal;
    expect(ratio).toBeGreaterThan(0.25);
    expect(ratio).toBeLessThan(4);
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
