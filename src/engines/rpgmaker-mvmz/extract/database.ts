/*
 * This file is part of rpgm-ai-translator.
 *
 * Copyright (C) 2026 Nikita Fedorov
 *
 * rpgm-ai-translator is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * rpgm-ai-translator is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with rpgm-ai-translator. If not, see <https://www.gnu.org/licenses/>.
 */

import type { ExtractOptions, TranslationCategory } from "../../../core/types/public-api.js";
import { extractEventCommandList, extractMap } from "./events.js";
import {
  type DraftBase,
  type JsonObject,
  type UnitDraft,
  isObject,
  isSafeRuntimeText,
  isTranslatableString,
  makeDraft,
  numberOrUndefined,
  stringOrUndefined
} from "./shared.js";

export function extractFromKnownFile(
  fileName: string,
  data: unknown,
  base: DraftBase & {
    extractOptions: ExtractOptions;
  }
): UnitDraft[] {
  if (Array.isArray(data)) {
    return extractArrayFile(fileName, data, base);
  }

  if (isObject(data) && fileName === "System.json") {
    return extractSystem(data, base);
  }

  if (isObject(data) && /^Map\d+\.json$/.test(fileName)) {
    return extractMap(data, base);
  }

  return [];
}

function extractArrayFile(
  fileName: string,
  rows: unknown[],
  base: DraftBase & {
    extractOptions: ExtractOptions;
  }
): UnitDraft[] {
  const units: UnitDraft[] = [];
  const fields = getArrayFileFields(fileName);

  if (fileName === "CommonEvents.json") {
    rows.forEach((row, rowIndex) => {
      if (!isObject(row)) {
        return;
      }
      units.push(
        ...extractEventCommandList(row.list, {
          ...base,
          prefix: `${rowIndex}.list`,
          context: { eventId: numberOrUndefined(row.id), eventName: stringOrUndefined(row.name) },
          includeComments: base.extractOptions.includeEventComments ?? false
        })
      );
    });
    return units;
  }

  // Troops carry a name plus one battle-event command list per page (the same
  // shape as a map event), so boss/battle Show Text and troop names — previously
  // dropped because Troops.json had no field map — are extracted here.
  if (fileName === "Troops.json") {
    rows.forEach((row, rowIndex) => {
      if (!isObject(row)) {
        return;
      }
      const context = { eventId: numberOrUndefined(row.id), eventName: stringOrUndefined(row.name) };
      const name = row.name;
      if (isTranslatableString(name) && isSafeRuntimeText(name)) {
        units.push(makeDraft(base, `${rowIndex}.name`, name, "name", context));
      }
      const pages = row.pages;
      if (Array.isArray(pages)) {
        pages.forEach((page, pageIndex) => {
          if (!isObject(page)) {
            return;
          }
          units.push(
            ...extractEventCommandList(page.list, {
              ...base,
              prefix: `${rowIndex}.pages.${pageIndex}.list`,
              context,
              includeComments: base.extractOptions.includeEventComments ?? false
            })
          );
        });
      }
    });
    return units;
  }

  const includeNotes = base.extractOptions.includeNotes === true;
  let sawUnextractedNote = false;

  for (const [rowIndex, row] of rows.entries()) {
    if (!isObject(row)) {
      continue;
    }

    for (const field of fields) {
      const source = row[field.name];
      if (isTranslatableString(source) && isSafeRuntimeText(source)) {
        units.push(
          makeDraft(base, `${rowIndex}.${field.name}`, source, field.category, {
            eventId: numberOrUndefined(row.id),
            eventName: stringOrUndefined(row.name)
          })
        );
      }
    }

    // The `note` field carries notetag text (plugin descriptions, etc.). Extract it
    // as a whole-field unit only with --include-notes, since notes frequently hold
    // configuration rather than display text; otherwise flag that translatable note
    // content exists so it is not silently dropped.
    const note = row.note;
    if (typeof note === "string" && note.trim().length > 0) {
      if (includeNotes && isTranslatableString(note) && isSafeRuntimeText(note)) {
        units.push(
          makeDraft(base, `${rowIndex}.note`, note, "description", {
            eventId: numberOrUndefined(row.id),
            eventName: stringOrUndefined(row.name)
          })
        );
      } else if (!includeNotes) {
        sawUnextractedNote = true;
      }
    }
  }

  if (sawUnextractedNote) {
    base.extractOptions.onWarning?.(
      `${fileName} has records with a non-empty note field; pass --include-notes to translate notetag text (review the output, as notes often hold plugin configuration).`
    );
  }

  return units;
}

export type DatabaseField = { name: string; category: TranslationCategory };

const NAME_AND_DESCRIPTION: readonly DatabaseField[] = [
  { name: "name", category: "name" },
  { name: "description", category: "description" }
];

// Single source of truth for the translatable per-row text fields of each
// array-shaped database file. Hoisting the field map out of a switch makes a
// dropped field visible in one place and lets the schema-coverage test assert the
// exact extracted id set per file (tests/extraction-schema.test.ts), guarding
// against a silent drop. The list-shaped files (CommonEvents/Troops) have no
// per-row field map and are handled directly in extractArrayFile; `note` is a
// cross-file field handled separately (opt-in via --include-notes).
export const DATABASE_ARRAY_FIELDS: Readonly<Record<string, readonly DatabaseField[]>> = {
  "Actors.json": [
    { name: "name", category: "name" },
    { name: "nickname", category: "name" },
    { name: "profile", category: "description" }
  ],
  "Classes.json": NAME_AND_DESCRIPTION,
  "Skills.json": [
    { name: "name", category: "name" },
    { name: "description", category: "description" },
    { name: "message1", category: "system" },
    { name: "message2", category: "system" }
  ],
  "Items.json": NAME_AND_DESCRIPTION,
  "Weapons.json": NAME_AND_DESCRIPTION,
  "Armors.json": NAME_AND_DESCRIPTION,
  "Enemies.json": [{ name: "name", category: "name" }],
  "States.json": [
    { name: "name", category: "name" },
    { name: "message1", category: "system" },
    { name: "message2", category: "system" },
    { name: "message3", category: "system" },
    { name: "message4", category: "system" }
  ],
  "MapInfos.json": [{ name: "name", category: "name" }]
};

function getArrayFileFields(fileName: string): readonly DatabaseField[] {
  return DATABASE_ARRAY_FIELDS[fileName] ?? [];
}

function extractSystem(data: JsonObject, base: DraftBase): UnitDraft[] {
  const units: UnitDraft[] = [];
  const directFields = ["gameTitle", "currencyUnit"] as const;
  for (const field of directFields) {
    const source = data[field];
    if (isTranslatableString(source)) {
      units.push(makeDraft(base, field, source, "system"));
    }
  }

  const arrayFields = ["armorTypes", "elements", "equipTypes", "skillTypes", "weaponTypes"] as const;
  for (const field of arrayFields) {
    const value = data[field];
    if (!Array.isArray(value)) {
      continue;
    }
    value.forEach((source, index) => {
      // RPG Maker reserves index 0 of these system arrays as an empty placeholder
      // (ids are 1-based); skip it explicitly. isTranslatableString would also
      // filter the empty slot, but the guard documents the 1-based convention.
      if (index > 0 && isTranslatableString(source)) {
        units.push(makeDraft(base, `${field}.${index}`, source, "system"));
      }
    });
  }

  for (const field of ["terms"] as const) {
    const value = data[field];
    if (isObject(value)) {
      units.push(...extractNestedStrings(value, field, base, "system"));
    }
  }

  return units;
}

function extractNestedStrings(
  value: unknown,
  prefix: string,
  base: DraftBase,
  category: TranslationCategory
): UnitDraft[] {
  if (isTranslatableString(value)) {
    return [makeDraft(base, prefix, value, category)];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => extractNestedStrings(item, `${prefix}.${index}`, base, category));
  }

  if (isObject(value)) {
    return Object.entries(value).flatMap(([key, item]) => extractNestedStrings(item, `${prefix}.${key}`, base, category));
  }

  return [];
}
