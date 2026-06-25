import { describe, expect, it } from "vitest";
import { MockProvider } from "../src/providers/mock.js";
import type { TranslationUnit } from "../src/core/types/types.js";

describe("MockProvider", () => {
  it("returns predictable translations for each unit", async () => {
    const units: TranslationUnit[] = [
      {
        id: "Items.1.description",
        source: String.raw`Restores \V[1] HP.`,
        normalizedSource: "Restores <PH_1> HP.",
        filePath: "data/Items.json",
        jsonPath: "1.description",
        engine: "rpgmaker-mv",
        category: "description",
        hash: "hash"
      }
    ];

    const results = await new MockProvider().translateBatch(units, { targetLanguage: "ru" });

    expect(results).toEqual([
      {
        id: "Items.1.description",
        source: String.raw`Restores \V[1] HP.`,
        translation: "[ru] Restores <PH_1> HP.",
        provider: "mock",
        model: "mock-echo",
        status: "translated"
      }
    ]);
  });

  it("returns current translations during review", async () => {
    const results = await new MockProvider().reviewBatch(
      [
        {
          id: "Map001.events.1.pages.0.list.1.parameters.0",
          source: "I am ready.",
          currentTranslation: "Я готов.",
          category: "dialogue"
        }
      ],
      { targetLanguage: "ru" }
    );

    expect(results).toEqual([
      {
        id: "Map001.events.1.pages.0.list.1.parameters.0",
        source: "I am ready.",
        translation: "Я готов.",
        provider: "mock",
        model: "mock-review",
        status: "translated",
        metadata: { reviewed: true }
      }
    ]);
  });

  it("returns deterministic repaired text when review units include validation issues", async () => {
    const results = await new MockProvider().reviewBatch(
      [
        {
          id: "Items.1.description",
          source: String.raw`Restores \V[1] HP.`,
          normalizedSource: "Restores <PH_1> HP.",
          currentTranslation: "Восстанавливает ОЗ.",
          category: "description",
          issues: [
            {
              id: "Items.1.description",
              severity: "error",
              code: "MISSING_PLACEHOLDER",
              message: "Missing placeholder <PH_1>"
            }
          ]
        }
      ],
      { targetLanguage: "ru" }
    );

    expect(results[0]).toMatchObject({
      translation: "[ru] Restores <PH_1> HP.",
      metadata: { reviewed: true }
    });
  });

  it("infers draft character entries", async () => {
    const result = await new MockProvider().inferCharacters(
      [
        {
          name: "Aria",
          suggestedTranslation: "Ария",
          sources: ["actor"],
          occurrences: 2,
          evidence: []
        }
      ],
      { targetLanguage: "ru" }
    );

    expect(result).toEqual({
      Aria: expect.objectContaining({
        translation: "Ария",
        gender: "unknown",
        type: "person",
        review: true
      })
    });
  });
});
