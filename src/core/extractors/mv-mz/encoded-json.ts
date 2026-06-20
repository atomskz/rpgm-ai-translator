import type { TranslationCategory, TranslationUnit } from "../../types.js";
import {
  type DraftBase,
  type UnitDraft,
  isObject,
  isSafeRuntimeText,
  makeDraft
} from "./shared.js";

export function extractEncodedJsonStrings(
  raw: string,
  outerJsonPath: string,
  base: DraftBase & {
    context?: TranslationUnit["context"];
  },
  category: TranslationCategory,
  constraints: TranslationUnit["constraints"]
): UnitDraft[] {
  const parsed = parseJsonString(raw);
  if (parsed == null) {
    return [];
  }

  const units: UnitDraft[] = [];
  visitEncodedJsonStrings(parsed, "", (encodedJsonPath, key, source) => {
    if (!isSafeEncodedJsonTextKey(key) || !isSafeRuntimeText(source)) {
      return;
    }
    units.push(
      makeDraft(base, outerJsonPath, source, category, base.context, {
        ...constraints,
        sourceEncoding: "json-stringified-json",
        encodedJsonPath
      })
    );
  });
  return units;
}

function visitEncodedJsonStrings(
  value: unknown,
  pathPrefix: string,
  visit: (jsonPath: string, key: string, value: string) => void
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitEncodedJsonStrings(item, joinJsonPath(pathPrefix, String(index)), visit));
    return;
  }

  if (!isObject(value)) {
    return;
  }

  for (const [key, item] of Object.entries(value)) {
    const jsonPath = joinJsonPath(pathPrefix, key);
    if (typeof item === "string") {
      visit(jsonPath, key, item);
    } else {
      visitEncodedJsonStrings(item, jsonPath, visit);
    }
  }
}

function parseJsonString(raw: string): unknown | undefined {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function joinJsonPath(prefix: string, segment: string): string {
  return prefix ? `${prefix}.${segment}` : segment;
}

function isSafeEncodedJsonTextKey(key: string): boolean {
  return /^(?:text|label|messageText|helpText|description|displayText|caption|title|commandName|itemName|optionName)$/i.test(key);
}
