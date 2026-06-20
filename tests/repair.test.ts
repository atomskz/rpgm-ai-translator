import { describe, expect, it } from "vitest";
import { repairTranslations } from "../src/core/repair/index.js";
import type { LLMProvider, ReviewOptions, ReviewUnit, TranslationResult, TranslationUnit } from "../src/core/types.js";

describe("repairTranslations", () => {
  it("retranslates missing translations and reviews issue-specific translated entries", async () => {
    const reviewedIssues: string[][] = [];
    const provider: LLMProvider = {
      name: "repair-test",
      translateBatch: async (batch, options) =>
        batch.map((unit) => ({
          id: unit.id,
          source: unit.source,
          translation: `[${options.targetLanguage}] ${unit.source}`,
          provider: "repair-test",
          model: "repair-model",
          status: "translated"
        })),
      reviewBatch: async (batch: ReviewUnit[], _options: ReviewOptions): Promise<TranslationResult[]> =>
        batch.map((unit) => {
          reviewedIssues.push((unit.issues ?? []).map((issue) => issue.code));
          return {
            id: unit.id,
            source: unit.source,
            translation: "Коротко.",
            provider: "repair-test",
            model: "repair-model",
            status: "translated"
          };
        }),
      inferCharacters: async () => ({})
    };

    const result = await repairTranslations(
      [
        unit("Actors.1.name", "Aria"),
        unit("Map001.events.1.pages.0.list.0.parameters.0", "A very long line.")
      ],
      [
        {
          id: "Map001.events.1.pages.0.list.0.parameters.0",
          source: "A very long line.",
          translation: "Очень длинная строка, которая не помещается.",
          provider: "deepseek",
          model: "deepseek-v4-flash",
          status: "translated"
        }
      ],
      [
        {
          id: "Actors.1.name",
          severity: "error",
          code: "MISSING_TRANSLATION",
          message: "Missing translation"
        },
        {
          id: "Map001.events.1.pages.0.list.0.parameters.0",
          severity: "warning",
          code: "MAX_LENGTH_EXCEEDED",
          message: "Too long"
        }
      ],
      provider,
      { targetLanguage: "ru", batchSize: 1 }
    );

    expect(result).toMatchObject({ repaired: 2, translated: 1, reviewed: 1, failed: 0 });
    expect(result.translations).toEqual([
      expect.objectContaining({
        id: "Actors.1.name",
        translation: "[ru] Aria",
        metadata: { repaired: true, repairMode: "translate" }
      }),
      expect.objectContaining({
        id: "Map001.events.1.pages.0.list.0.parameters.0",
        translation: "Коротко.",
        metadata: { repaired: true, repairMode: "review" }
      })
    ]);
    expect(reviewedIssues).toEqual([["MAX_LENGTH_EXCEEDED"]]);
  });

  it("can restrict repairs to selected validation issue codes", async () => {
    const provider: LLMProvider = {
      name: "repair-test",
      translateBatch: async () => [],
      reviewBatch: async (batch: ReviewUnit[]): Promise<TranslationResult[]> =>
        batch.map((unit) => ({
          id: unit.id,
          source: unit.source,
          translation: "Исправлено.",
          provider: "repair-test",
          model: "repair-model",
          status: "translated"
        })),
      inferCharacters: async () => ({})
    };

    const result = await repairTranslations(
      [unit("Actors.1.name", "Aria"), unit("Actors.2.name", "Bel")],
      [
        translation("Actors.1.name", "Ария"),
        translation("Actors.2.name", "Бел")
      ],
      [
        { id: "Actors.1.name", severity: "warning", code: "UNCHANGED_TRANSLATION", message: "Unchanged" },
        { id: "Actors.2.name", severity: "warning", code: "MAX_LENGTH_EXCEEDED", message: "Too long" }
      ],
      provider,
      { targetLanguage: "ru", issueCodes: ["MAX_LENGTH_EXCEEDED"] }
    );

    expect(result.repaired).toBe(1);
    expect(result.translations).toEqual([
      expect.objectContaining({ id: "Actors.1.name", translation: "Ария" }),
      expect.objectContaining({ id: "Actors.2.name", translation: "Исправлено." })
    ]);
  });

  it("emits repaired batch results for checkpoint writers", async () => {
    const checkpointResults: TranslationResult[][] = [];
    const provider: LLMProvider = {
      name: "repair-test",
      translateBatch: async (batch, options) =>
        batch.map((item) => ({
          id: item.id,
          source: item.source,
          translation: `[${options.targetLanguage}] ${item.source}`,
          provider: "repair-test",
          model: "repair-model",
          status: "translated"
        })),
      reviewBatch: async (batch: ReviewUnit[]): Promise<TranslationResult[]> =>
        batch.map((item) => ({
          id: item.id,
          source: item.source,
          translation: "Коротко.",
          provider: "repair-test",
          model: "repair-model",
          status: "translated"
        })),
      inferCharacters: async () => ({})
    };

    await repairTranslations(
      [
        unit("Actors.1.name", "Aria"),
        unit("Map001.events.1.pages.0.list.0.parameters.0", "A very long line.")
      ],
      [translation("Map001.events.1.pages.0.list.0.parameters.0", "Слишком длинно.")],
      [
        { id: "Actors.1.name", severity: "error", code: "MISSING_TRANSLATION", message: "Missing" },
        {
          id: "Map001.events.1.pages.0.list.0.parameters.0",
          severity: "warning",
          code: "MAX_LENGTH_EXCEEDED",
          message: "Too long"
        }
      ],
      provider,
      {
        targetLanguage: "ru",
        batchSize: 1,
        onBatchResults: (results) => checkpointResults.push(results)
      }
    );

    expect(checkpointResults).toEqual([
      [
        expect.objectContaining({
          id: "Actors.1.name",
          metadata: { repaired: true, repairMode: "translate" }
        })
      ],
      [
        expect.objectContaining({
          id: "Map001.events.1.pages.0.list.0.parameters.0",
          metadata: { repaired: true, repairMode: "review" }
        })
      ]
    ]);
  });
});

function unit(id: string, source: string): TranslationUnit {
  return {
    id,
    source,
    normalizedSource: source,
    filePath: "data/Actors.json",
    jsonPath: "1.name",
    engine: "rpgmaker-mv",
    category: "name",
    hash: `hash-${id}`
  };
}

function translation(id: string, text: string): TranslationResult {
  return {
    id,
    source: text,
    translation: text,
    provider: "deepseek",
    model: "deepseek-v4-flash",
    status: "translated"
  };
}
