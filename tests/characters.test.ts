import { describe, expect, it } from "vitest";
import {
  candidatesToDraftGlossary,
  extractCharacterCandidates,
  inferCharacterGlossary
} from "../src/core/characters/index.js";
import { TokenBudget } from "../src/core/cost/index.js";
import type { LLMProvider, TranslationUnit } from "../src/core/types.js";

describe("character candidates", () => {
  it("extracts actors and speakers while skipping technical event names", () => {
    const candidates = extractCharacterCandidates([
      unit({ id: "Actors.1.name", source: "Aria", category: "name" }),
      unit({
        id: "Map001.events.1.pages.0.list.0.parameters.0",
        source: "I am ready.",
        category: "dialogue",
        context: { speaker: "Aria", eventName: "Chest01" }
      })
    ]);

    expect(candidates).toEqual([
      expect.objectContaining({
        name: "Aria",
        sources: expect.arrayContaining(["actor", "speaker"]),
        occurrences: 2
      })
    ]);
  });

  it("does not create candidates from event names alone", () => {
    const candidates = extractCharacterCandidates([
      unit({
        id: "Map001.events.1.pages.0.list.0.parameters.0",
        source: "Hello.",
        category: "dialogue",
        context: { eventName: "Pato02" }
      })
    ]);

    expect(candidates).toEqual([]);
  });

  it("creates draft glossary entries for manual editing", () => {
    const glossary = candidatesToDraftGlossary([
      {
        name: "Aria",
        suggestedTranslation: "Ария",
        sources: ["actor"],
        occurrences: 1,
        evidence: []
      }
    ]);

    expect(glossary).toEqual({
      Aria: expect.objectContaining({
        translation: "Ария",
        gender: "unknown",
        type: "person",
        review: true
      })
    });
  });

  it("runs provider inference in batches", async () => {
    const seen: string[][] = [];
    const provider: LLMProvider = {
      name: "test",
      translateBatch: async () => [],
      reviewBatch: async () => [],
      inferCharacters: async (batch) => {
        seen.push(batch.map((candidate) => candidate.name));
        return Object.fromEntries(batch.map((candidate) => [candidate.name, { gender: "unknown", type: "person" }]));
      }
    };

    const result = await inferCharacterGlossary(
      [
        { name: "A", sources: ["actor"], occurrences: 1, evidence: [] },
        { name: "B", sources: ["actor"], occurrences: 1, evidence: [] }
      ],
      provider,
      { targetLanguage: "ru", batchSize: 1 }
    );

    expect(seen).toEqual([["A"], ["B"]]);
    expect(Object.keys(result)).toEqual(["A", "B"]);
  });

  it("retries character inference before falling back to manual review", async () => {
    let calls = 0;
    const provider: LLMProvider = {
      name: "test",
      translateBatch: async () => [],
      reviewBatch: async () => [],
      inferCharacters: async (batch) => {
        calls += 1;
        if (calls === 1) {
          throw new Error("temporary failure");
        }
        return Object.fromEntries(batch.map((candidate) => [candidate.name, { gender: "unknown", type: "person" }]));
      }
    };

    const result = await inferCharacterGlossary(
      [{ name: "Aria", sources: ["actor"], occurrences: 1, evidence: [] }],
      provider,
      { targetLanguage: "ru", retryAttempts: 1, retryDelayMs: 0 }
    );

    expect(calls).toBe(2);
    expect(result.Aria).toMatchObject({ type: "person" });
    expect(result.Aria.description ?? "").not.toContain("Character inference failed");
  });

  it("falls back to manual-review entries when provider inference fails", async () => {
    const provider: LLMProvider = {
      name: "test",
      translateBatch: async () => [],
      reviewBatch: async () => [],
      inferCharacters: async () => {
        throw new Error("bad JSON");
      }
    };

    const result = await inferCharacterGlossary(
      [{ name: "Aria", sources: ["actor"], occurrences: 1, evidence: [] }],
      provider,
      { targetLanguage: "ru" }
    );

    expect(result.Aria).toMatchObject({
      gender: "unknown",
      confidence: 0,
      review: true
    });
    expect(result.Aria.description).toContain("bad JSON");
  });

  it("warns and keeps a review draft when the model omits a requested candidate", async () => {
    const provider: LLMProvider = {
      name: "test",
      translateBatch: async () => [],
      reviewBatch: async () => [],
      // Returns only the first requested name, dropping the rest.
      inferCharacters: async (batch) => ({ [batch[0].name]: { gender: "unknown", type: "person" } })
    };
    const warnings: string[] = [];

    const result = await inferCharacterGlossary(
      [
        { name: "Aria", sources: ["actor"], occurrences: 1, evidence: [] },
        { name: "Borin", sources: ["actor"], occurrences: 1, evidence: [] }
      ],
      provider,
      { targetLanguage: "ru", batchSize: 2, onWarning: (message) => warnings.push(message) }
    );

    expect(Object.keys(result).sort()).toEqual(["Aria", "Borin"]);
    expect(result.Borin).toMatchObject({ review: true });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("omitted 1 requested name(s): Borin");
  });

  it("drops and warns about an unrequested name returned by the model", async () => {
    const provider: LLMProvider = {
      name: "test",
      translateBatch: async () => [],
      reviewBatch: async () => [],
      inferCharacters: async (batch) => ({
        [batch[0].name]: { gender: "unknown", type: "person" },
        Ghost: { gender: "unknown", type: "person" }
      })
    };
    const warnings: string[] = [];

    const result = await inferCharacterGlossary(
      [{ name: "Aria", sources: ["actor"], occurrences: 1, evidence: [] }],
      provider,
      { targetLanguage: "ru", onWarning: (message) => warnings.push(message) }
    );

    expect(Object.keys(result)).toEqual(["Aria"]);
    expect(warnings[0]).toContain("returned 1 unrequested name(s): Ghost");
  });

  it("aborts character inference once the token budget is exceeded", async () => {
    const seen: string[][] = [];
    const provider: LLMProvider = {
      name: "test",
      translateBatch: async () => [],
      reviewBatch: async () => [],
      inferCharacters: async (batch) => {
        seen.push(batch.map((candidate) => candidate.name));
        return Object.fromEntries(batch.map((candidate) => [candidate.name, { gender: "unknown", type: "person" }]));
      }
    };

    await expect(
      inferCharacterGlossary(
        [
          { name: "Aria", sources: ["actor"], occurrences: 1, evidence: [] },
          { name: "Borin", sources: ["actor"], occurrences: 1, evidence: [] }
        ],
        provider,
        { targetLanguage: "ru", batchSize: 1 },
        // 20 admits the first batch (~17 estimated tokens) but not the cumulative
        // second (~35), so the budget trips before the second provider call.
        new TokenBudget(20)
      )
    ).rejects.toThrow(/--max-tokens-budget/);

    // The first batch was sent, then the budget tripped before the second.
    expect(seen).toEqual([["Aria"]]);
  });

  it("refuses the first batch before calling the provider when already over budget", async () => {
    const seen: string[][] = [];
    const provider: LLMProvider = {
      name: "test",
      translateBatch: async () => [],
      reviewBatch: async () => [],
      inferCharacters: async (batch) => {
        seen.push(batch.map((candidate) => candidate.name));
        return {};
      }
    };
    // A budget already spent by earlier passes leaves no room; projecting the next
    // batch against it must refuse before any provider call.
    const budget = new TokenBudget(10);
    budget.record([
      { id: "x", source: "x", translation: "x", provider: "p", model: "m", status: "translated", metadata: { tokenUsage: { inputTokens: 8, outputTokens: 0, totalTokens: 8 } } }
    ]);

    await expect(
      inferCharacterGlossary(
        [{ name: "Aria", sources: ["actor"], occurrences: 1, evidence: [] }],
        provider,
        { targetLanguage: "ru", batchSize: 1 },
        budget
      )
    ).rejects.toThrow(/--max-tokens-budget/);
    expect(seen).toEqual([]);
  });

  it("keeps the higher-confidence entry when a name recurs across batches", async () => {
    let call = 0;
    const provider: LLMProvider = {
      name: "test",
      translateBatch: async () => [],
      reviewBatch: async () => [],
      inferCharacters: async (batch) => {
        call += 1;
        const confidence = call === 1 ? 0.9 : 0.3;
        return Object.fromEntries(batch.map((candidate) => [candidate.name, { gender: "unknown", type: "person", confidence }]));
      }
    };

    const result = await inferCharacterGlossary(
      [
        { name: "Aria", sources: ["actor"], occurrences: 1, evidence: [] },
        { name: "Aria", sources: ["actor"], occurrences: 1, evidence: [] }
      ],
      provider,
      { targetLanguage: "ru", batchSize: 1 }
    );

    expect(result.Aria.confidence).toBe(0.9);
  });
});

function unit(overrides: Partial<TranslationUnit> = {}): TranslationUnit {
  return {
    id: "Actors.1.name",
    source: "Aria",
    filePath: "data/Actors.json",
    jsonPath: "1.name",
    engine: "rpgmaker-mz",
    category: "name",
    hash: "hash",
    ...overrides
  };
}
