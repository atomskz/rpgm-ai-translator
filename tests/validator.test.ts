import { describe, expect, it } from "vitest";
import { protectPlaceholders } from "../src/core/placeholders/index.js";
import {
  DefaultValidator,
  filterTranslationsWithoutValidationErrors,
  validateTranslationResults
} from "../src/core/validators/index.js";
import type { Glossary, TranslationResult, TranslationUnit, ValidationIssue } from "../src/core/types.js";

describe("DefaultValidator", () => {
  it("reports id mismatches", () => {
    const issues = validate(unit(), result({ id: "Wrong.id", translation: "Ария" }));

    expect(codes(issues)).toContain("ID_MISMATCH");
  });

  it("reports failed and skipped translations as missing translations", () => {
    const failedIssues = validate(unit(), result({ status: "failed", translation: "" }));
    const skippedIssues = validate(unit(), result({ status: "skipped", translation: "" }));

    expect(failedIssues).toContainEqual(
      expect.objectContaining({ code: "MISSING_TRANSLATION", severity: "error" })
    );
    expect(skippedIssues).toContainEqual(
      expect.objectContaining({ code: "MISSING_TRANSLATION", severity: "info" })
    );
  });

  it("keeps provider JSON parsing issues in validation output", () => {
    const issues = validate(
      unit(),
      result({
        status: "failed",
        translation: "",
        issues: [
          {
            id: "Actors.1.name",
            severity: "error",
            code: "INVALID_JSON",
            message: "Provider returned invalid JSON"
          }
        ]
      })
    );

    expect(codes(issues)).toContain("INVALID_JSON");
  });

  it("reports empty translations", () => {
    const issues = validate(unit(), result({ translation: " " }));

    expect(codes(issues)).toContain("EMPTY_TRANSLATION");
    expect(codes(issues)).toContain("MISSING_TRANSLATION");
  });

  it("reports unchanged translations", () => {
    const issues = validate(unit({ source: "Aria", normalizedSource: "Aria" }), result({ translation: "Aria" }));

    expect(codes(issues)).toContain("UNCHANGED_TRANSLATION");
  });

  it("reports missing, extra, and duplicate placeholders", () => {
    const protectedText = protectPlaceholders(String.raw`Hello \N[1], take \I[64].`);
    const unitWithPlaceholders = unit({
      id: "Map001.events.1.pages.0.list.0.parameters.0",
      source: String.raw`Hello \N[1], take \I[64].`,
      normalizedSource: protectedText.text,
      filePath: "data/Map001.json",
      jsonPath: "events.1.pages.0.list.0.parameters.0",
      engine: "rpgmaker-mz",
      category: "dialogue",
      placeholders: protectedText.placeholders
    });

    const missingAndExtra = validate(
      unitWithPlaceholders,
      result({
        id: unitWithPlaceholders.id,
        source: unitWithPlaceholders.source,
        translation: "Привет <PH_1>, возьми <PH_3>."
      })
    );
    const duplicate = validate(
      unitWithPlaceholders,
      result({
        id: unitWithPlaceholders.id,
        source: unitWithPlaceholders.source,
        translation: "Привет <PH_1> <PH_1>, возьми <PH_2>."
      })
    );

    expect(codes(missingAndExtra)).toContain("MISSING_PLACEHOLDER");
    expect(codes(missingAndExtra)).toContain("EXTRA_PLACEHOLDER");
    expect(codes(duplicate)).toContain("DUPLICATE_PLACEHOLDER");
  });

  it("reports changed control codes through missing placeholders", () => {
    const protectedText = protectPlaceholders(String.raw`Take \I[64].`);
    const issues = validate(
      unit({
        source: String.raw`Take \I[64].`,
        normalizedSource: protectedText.text,
        placeholders: protectedText.placeholders
      }),
      result({ source: String.raw`Take \I[64].`, translation: "Возьми иконку." })
    );

    expect(codes(issues)).toContain("CONTROL_CODE_CHANGED");
  });

  it("accepts exact raw placeholder values when providers preserve control codes directly", () => {
    const protectedText = protectPlaceholders(String.raw`Cast \C[4]Prayer\C[0].`);
    const issues = validate(
      unit({
        source: String.raw`Cast \C[4]Prayer\C[0].`,
        normalizedSource: protectedText.text,
        placeholders: protectedText.placeholders
      }),
      result({
        source: String.raw`Cast \C[4]Prayer\C[0].`,
        translation: String.raw`Примени \C[4]Молитву\C[0].`
      })
    );

    expect(codes(issues)).not.toContain("MISSING_PLACEHOLDER");
    expect(codes(issues)).not.toContain("CONTROL_CODE_CHANGED");
  });

  it("reports changed custom plugin control codes", () => {
    const protectedText = protectPlaceholders(String.raw`Belffie\MPD[Surprise]`);
    const issues = validate(
      unit({
        source: String.raw`Belffie\MPD[Surprise]`,
        normalizedSource: protectedText.text,
        placeholders: protectedText.placeholders
      }),
      result({
        source: String.raw`Belffie\MPD[Surprise]`,
        translation: String.raw`Белффи\MPD[Happy]`
      })
    );

    expect(codes(issues)).toContain("MISSING_PLACEHOLDER");
    expect(codes(issues)).toContain("CONTROL_CODE_CHANGED");
  });

  it("accepts repeated raw placeholder values when each matching placeholder occurrence is preserved", () => {
    const protectedText = protectPlaceholders(String.raw`Use \C[4]Prayer\C[0] in \C[4]Tactics\C[0].`);
    const issues = validate(
      unit({
        source: String.raw`Use \C[4]Prayer\C[0] in \C[4]Tactics\C[0].`,
        normalizedSource: protectedText.text,
        placeholders: protectedText.placeholders
      }),
      result({
        source: String.raw`Use \C[4]Prayer\C[0] in \C[4]Tactics\C[0].`,
        translation: String.raw`Используй \C[4]Молитву\C[0] в \C[4]Тактике\C[0].`
      })
    );

    expect(codes(issues)).not.toContain("DUPLICATE_PLACEHOLDER");
    expect(codes(issues)).not.toContain("MISSING_PLACEHOLDER");
    expect(codes(issues)).not.toContain("CONTROL_CODE_CHANGED");
  });

  it("reports changed numbers", () => {
    const issues = validate(unit({ source: "Gain 500G.", normalizedSource: "Gain 500G." }), result({ translation: "Получи 50G." }));

    expect(codes(issues)).toContain("NUMBER_CHANGED");
  });

  it("ignores control-code digits when comparing numbers", () => {
    const protectedText = protectPlaceholders(String.raw`\C[4]Prayer\C[0]`);
    const issues = validate(
      unit({
        source: String.raw`\C[4]Prayer\C[0]`,
        normalizedSource: protectedText.text,
        placeholders: protectedText.placeholders
      }),
      // Colour codes reordered; no real in-game number changed.
      result({ source: String.raw`\C[4]Prayer\C[0]`, translation: "<PH_2>Молитва<PH_1>" })
    );

    expect(codes(issues)).not.toContain("NUMBER_CHANGED");
  });

  it("still flags a real in-game number change next to control codes", () => {
    const protectedText = protectPlaceholders(String.raw`\C[4]Gain 500G\C[0]`);
    const issues = validate(
      unit({
        source: String.raw`\C[4]Gain 500G\C[0]`,
        normalizedSource: protectedText.text,
        placeholders: protectedText.placeholders
      }),
      result({ source: String.raw`\C[4]Gain 500G\C[0]`, translation: "<PH_1>Получи 50G<PH_2>" })
    );

    expect(codes(issues)).toContain("NUMBER_CHANGED");
  });

  it("reports changed variables", () => {
    const protectedText = protectPlaceholders("Hello {playerName}.");
    const issues = validate(
      unit({
        source: "Hello {playerName}.",
        normalizedSource: protectedText.text,
        placeholders: protectedText.placeholders
      }),
      result({ source: "Hello {playerName}.", translation: "Привет <PH_1_WRONG>." })
    );

    expect(codes(issues)).toContain("VARIABLE_CHANGED");
  });

  it("reports changed technical tokens", () => {
    const protectedText = protectPlaceholders("Use <ItemTag>.");
    const issues = validate(
      unit({
        source: "Use <ItemTag>.",
        normalizedSource: protectedText.text,
        placeholders: protectedText.placeholders
      }),
      result({ source: "Use <ItemTag>.", translation: "Используй <WrongTag>." })
    );

    expect(codes(issues)).toContain("TECHNICAL_TOKEN_CHANGED");
  });

  it("reports max length and max lines violations", () => {
    const issues = validate(
      unit({ constraints: { maxLength: 5, maxLines: 1 } }),
      result({ translation: "Очень длинно\nи две строки" })
    );

    expect(codes(issues)).toContain("MAX_LENGTH_EXCEEDED");
    expect(codes(issues)).toContain("MAX_LINES_EXCEEDED");
  });

  it("measures maxLength against restored control codes, not placeholder tokens", () => {
    const protectedText = protectPlaceholders(String.raw`\C[1]X\C[0]`);
    const issues = validate(
      unit({
        source: String.raw`\C[1]X\C[0]`,
        normalizedSource: protectedText.text,
        placeholders: protectedText.placeholders,
        constraints: { maxLength: 13 }
      }),
      // Restored length is 12 (`\C[1]Да\C[0]`); the masked `<PH_1>Да<PH_2>`
      // form is 14, which the old check wrongly flagged.
      result({ source: String.raw`\C[1]X\C[0]`, translation: "<PH_1>Да<PH_2>" })
    );

    expect(codes(issues)).not.toContain("MAX_LENGTH_EXCEEDED");
  });

  it("treats number drift and extra lines as apply-blocking errors", () => {
    const numberIssues = validate(
      unit({ source: "Gain 500G.", normalizedSource: "Gain 500G." }),
      result({ translation: "Получи 50G." })
    );
    const lineIssues = validate(
      unit({ constraints: { maxLines: 1 } }),
      result({ translation: "Строка\nещё строка" })
    );

    expect(numberIssues).toContainEqual(
      expect.objectContaining({ code: "NUMBER_CHANGED", severity: "error" })
    );
    expect(lineIssues).toContainEqual(
      expect.objectContaining({ code: "MAX_LINES_EXCEEDED", severity: "error" })
    );
  });

  it("checks glossary keep and custom terms", () => {
    const glossary: Glossary = {
      Aria: { mode: "custom", translation: "Ария" },
      Moonfall: { mode: "keep" }
    };
    const issues = validate(
      unit({ source: "Aria visits Moonfall.", normalizedSource: "Aria visits Moonfall." }),
      result({ source: "Aria visits Moonfall.", translation: "Ариа посещает Лунопад." }),
      glossary
    );

    expect(codes(issues)).toContain("GLOSSARY_VIOLATION");
  });
});

describe("validateTranslationResults", () => {
  it("reports unknown translation ids and missing translations", () => {
    const known = unit({ id: "Actors.1.name" });
    const missing = unit({ id: "Actors.2.name", jsonPath: "2.name" });

    const issues = validateTranslationResults(
      [known, missing],
      [result({ id: "Unknown.1.name", translation: "???" }), result({ id: known.id, translation: "Ария" })]
    );

    expect(issues).toContainEqual(
      expect.objectContaining({ id: "Unknown.1.name", code: "UNKNOWN_TRANSLATION_ID" })
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ id: "Actors.2.name", code: "MISSING_TRANSLATION" })
    );
  });

  it("filters out translations with validation errors before apply", () => {
    const translations = [
      result({ id: "Actors.1.name", translation: "Ария" }),
      result({ id: "Actors.2.name", translation: "" })
    ];

    expect(
      filterTranslationsWithoutValidationErrors(translations, [
        {
          id: "Actors.2.name",
          severity: "error",
          code: "MISSING_TRANSLATION",
          message: "Missing"
        },
        {
          id: "Actors.1.name",
          severity: "warning",
          code: "UNCHANGED_TRANSLATION",
          message: "Warning only"
        }
      ])
    ).toEqual([translations[0]]);
  });
});

function validate(unitValue: TranslationUnit, resultValue: TranslationResult, glossary?: Glossary): ValidationIssue[] {
  return new DefaultValidator(glossary).validate(unitValue, resultValue);
}

function codes(issues: ValidationIssue[]): ValidationIssue["code"][] {
  return issues.map((issue) => issue.code);
}

function unit(overrides: Partial<TranslationUnit> = {}): TranslationUnit {
  return {
    id: "Actors.1.name",
    source: "Aria",
    normalizedSource: "Aria",
    filePath: "data/Actors.json",
    jsonPath: "1.name",
    engine: "rpgmaker-mv",
    category: "name",
    hash: "hash",
    ...overrides
  };
}

function result(overrides: Partial<TranslationResult> = {}): TranslationResult {
  return {
    id: "Actors.1.name",
    source: "Aria",
    translation: "Ария",
    provider: "mock",
    model: "mock",
    status: "translated",
    ...overrides
  };
}
