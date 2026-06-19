import { describe, expect, it } from "vitest";
import { reviewTranslations } from "../src/core/review/index.js";
import type { LLMProvider, ReviewOptions, ReviewUnit, TranslationResult, TranslationUnit } from "../src/core/types.js";

describe("reviewTranslations", () => {
  it("reviews translated dialogue and keeps unrelated translations unchanged", async () => {
    const provider: LLMProvider = {
      name: "review-test",
      translateBatch: async () => [],
      reviewBatch: async (batch: ReviewUnit[], options: ReviewOptions): Promise<TranslationResult[]> =>
        batch.map((unit) => ({
          id: unit.id,
          source: unit.source,
          translation: `${unit.currentTranslation} (${options.targetLanguage} reviewed)`,
          provider: "review-test",
          model: "review-model",
          status: "translated",
          metadata: { reviewed: true }
        })),
      inferCharacters: async () => ({})
    };

    const result = await reviewTranslations(
      [
        unit({ id: "Map001.events.1.pages.0.list.0.parameters.0", category: "dialogue" }),
        unit({ id: "Items.1.name", category: "name" })
      ],
      [
        translation({ id: "Map001.events.1.pages.0.list.0.parameters.0", translation: "Я готов." }),
        translation({ id: "Items.1.name", translation: "Зелье" })
      ],
      provider,
      { targetLanguage: "ru" }
    );

    expect(result).toMatchObject({ reviewed: 1, failed: 0 });
    expect(result.translations).toEqual([
      expect.objectContaining({
        id: "Map001.events.1.pages.0.list.0.parameters.0",
        translation: "Я готов. (ru reviewed)",
        metadata: { reviewed: true }
      }),
      expect.objectContaining({
        id: "Items.1.name",
        translation: "Зелье"
      })
    ]);
  });

  it("emits review progress events", async () => {
    const events: string[] = [];
    const provider: LLMProvider = {
      name: "review-test",
      translateBatch: async () => [],
      reviewBatch: async (batch: ReviewUnit[]): Promise<TranslationResult[]> =>
        batch.map((item) => ({
          id: item.id,
          source: item.source,
          translation: item.currentTranslation,
          provider: "review-test",
          model: "review-model",
          status: "translated"
        })),
      inferCharacters: async () => ({})
    };

    await reviewTranslations(
      [unit({ id: "Map001.events.1.pages.0.list.0.parameters.0" })],
      [translation({ id: "Map001.events.1.pages.0.list.0.parameters.0" })],
      provider,
      {
        targetLanguage: "ru",
        onProgress: (event) => events.push(event.type)
      }
    );

    expect(events).toEqual(["review-batch-start", "review-batch-complete"]);
  });

  it("emits reviewed batch results for checkpoint writers", async () => {
    const checkpointResults: TranslationResult[][] = [];
    const provider: LLMProvider = {
      name: "review-test",
      translateBatch: async () => [],
      reviewBatch: async (batch: ReviewUnit[]): Promise<TranslationResult[]> =>
        batch.map((item) => ({
          id: item.id,
          source: item.source,
          translation: `${item.currentTranslation} ok`,
          provider: "review-test",
          model: "review-model",
          status: "translated"
        })),
      inferCharacters: async () => ({})
    };

    await reviewTranslations(
      [unit({ id: "Map001.events.1.pages.0.list.0.parameters.0" })],
      [translation({ id: "Map001.events.1.pages.0.list.0.parameters.0" })],
      provider,
      {
        targetLanguage: "ru",
        onBatchResults: (results) => checkpointResults.push(results)
      }
    );

    expect(checkpointResults).toEqual([
      [
        expect.objectContaining({
          id: "Map001.events.1.pages.0.list.0.parameters.0",
          translation: "Я готов. ok",
          metadata: { reviewed: true }
        })
      ]
    ]);
  });
});

function unit(overrides: Partial<TranslationUnit> = {}): TranslationUnit {
  return {
    id: "Map001.events.1.pages.0.list.0.parameters.0",
    source: "I am ready.",
    normalizedSource: "I am ready.",
    filePath: "data/Map001.json",
    jsonPath: "events.1.pages.0.list.0.parameters.0",
    engine: "rpgmaker-mz",
    category: "dialogue",
    context: { mapName: "Town", eventId: 1, speaker: "Aria" },
    hash: "hash",
    ...overrides
  };
}

function translation(overrides: Partial<TranslationResult> = {}): TranslationResult {
  return {
    id: "Map001.events.1.pages.0.list.0.parameters.0",
    source: "I am ready.",
    translation: "Я готов.",
    provider: "deepseek",
    model: "deepseek-chat",
    status: "translated",
    ...overrides
  };
}
