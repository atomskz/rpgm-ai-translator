import { describe, expect, it } from "vitest";
import {
  candidatesToDraftGlossary,
  extractCharacterCandidates,
  inferCharacterGlossary
} from "../src/core/characters/index.js";
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
