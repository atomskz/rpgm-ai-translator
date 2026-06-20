import type { ExtractOptions, TranslationCategory } from "../../types.js";
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
  }

  return units;
}

function getArrayFileFields(fileName: string): Array<{ name: string; category: TranslationCategory }> {
  switch (fileName) {
    case "Actors.json":
      return [
        { name: "name", category: "name" },
        { name: "nickname", category: "name" },
        { name: "profile", category: "description" }
      ];
    case "Classes.json":
      return [
        { name: "name", category: "name" },
        { name: "description", category: "description" }
      ];
    case "Skills.json":
      return [
        { name: "name", category: "name" },
        { name: "description", category: "description" },
        { name: "message1", category: "system" },
        { name: "message2", category: "system" }
      ];
    case "Items.json":
    case "Weapons.json":
    case "Armors.json":
      return [
        { name: "name", category: "name" },
        { name: "description", category: "description" }
      ];
    case "Enemies.json":
      return [{ name: "name", category: "name" }];
    case "States.json":
      return [
        { name: "name", category: "name" },
        { name: "message1", category: "system" },
        { name: "message2", category: "system" },
        { name: "message3", category: "system" },
        { name: "message4", category: "system" }
      ];
    case "MapInfos.json":
      return [{ name: "name", category: "name" }];
    default:
      return [];
  }
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
