import { describe, expect, it } from "vitest";
import { DATABASE_ARRAY_FIELDS, extractFromKnownFile } from "../src/engines/rpgmaker-mvmz/extract/database.js";
import type { DraftBase } from "../src/engines/rpgmaker-mvmz/extract/shared.js";
import type { ExtractOptions } from "../src/core/types/public-api.js";

function baseFor(fileName: string): DraftBase & { extractOptions: ExtractOptions } {
  return {
    absoluteFilePath: `/game/data/${fileName}`,
    relativeFilePath: `data/${fileName}`,
    engine: "rpgmaker-mz",
    extractOptions: {}
  };
}

// A translatable value for a field that passes the runtime-text safety filter
// (has a translatable letter, is not an asset path / $game ref / boolean).
function valueFor(field: string): string {
  return `${field} text`;
}

describe("database schema coverage", () => {
  // For each array-shaped database file, a row that populates every mapped field
  // must extract exactly those fields — no more, no fewer. This guards against a
  // field being silently dropped from the map (or an unexpected field leaking in).
  for (const [fileName, fields] of Object.entries(DATABASE_ARRAY_FIELDS)) {
    it(`extracts exactly the mapped fields of ${fileName}`, () => {
      const row: Record<string, unknown> = { id: 1 };
      for (const field of fields) {
        row[field.name] = valueFor(field.name);
      }
      // An unmapped text field must not be extracted.
      row.unmappedField = "should not be extracted";

      const drafts = extractFromKnownFile(fileName, [row], baseFor(fileName));

      const extracted = drafts.map((draft) => ({ jsonPath: draft.jsonPath, category: draft.category })).sort(byJsonPath);
      const expected = fields.map((field) => ({ jsonPath: `0.${field.name}`, category: field.category })).sort(byJsonPath);
      expect(extracted).toEqual(expected);
    });
  }

  it("covers the core RPG Maker database files", () => {
    // A reminder guard: if a known file is removed from the map, this fails so the
    // drop is deliberate rather than silent.
    const files = Object.keys(DATABASE_ARRAY_FIELDS);
    for (const expected of ["Actors.json", "Items.json", "Weapons.json", "Armors.json", "Skills.json", "Enemies.json", "States.json", "MapInfos.json"]) {
      expect(files).toContain(expected);
    }
  });

  it("extracts the note field only with --include-notes", () => {
    const row = { id: 1, name: "Hero", note: "A translatable note." };

    const without = extractFromKnownFile("Actors.json", [row], baseFor("Actors.json"));
    expect(without.map((draft) => draft.jsonPath)).not.toContain("0.note");

    const withNotes = extractFromKnownFile("Actors.json", [row], {
      ...baseFor("Actors.json"),
      extractOptions: { includeNotes: true }
    });
    expect(withNotes.map((draft) => draft.jsonPath)).toContain("0.note");
  });
});

function byJsonPath(a: { jsonPath: string }, b: { jsonPath: string }): number {
  return a.jsonPath.localeCompare(b.jsonPath);
}
