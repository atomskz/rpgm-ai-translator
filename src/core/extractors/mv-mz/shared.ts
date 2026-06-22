import path from "node:path";
import type { EngineId, TranslationCategory, TranslationUnit } from "../../types.js";
import { protectPlaceholders } from "../../placeholders/index.js";
import { hashSource } from "../../utils/hash.js";
import { containsTranslatableLetter } from "../../utils/text.js";

export type JsonObject = Record<string, unknown>;

export type UnitDraft = {
  source: string;
  absoluteFilePath: string;
  relativeFilePath: string;
  jsonPath: string;
  engine: EngineId;
  category: TranslationCategory;
  context?: TranslationUnit["context"];
  constraints?: TranslationUnit["constraints"];
};

export type DraftBase = Pick<UnitDraft, "absoluteFilePath" | "relativeFilePath" | "engine">;

export function makeDraft(
  base: DraftBase,
  jsonPath: string,
  source: string,
  category: TranslationCategory,
  context?: TranslationUnit["context"],
  constraints: TranslationUnit["constraints"] = {}
): UnitDraft {
  return {
    ...base,
    source,
    jsonPath,
    category,
    context,
    constraints: {
      preserveControlCodes: true,
      preserveNewlines: source.includes("\n"),
      maxLines: source.includes("\n") ? source.split(/\r?\n/).length : constraints.maxLines,
      ...constraints
    }
  };
}

export function toTranslationUnit(draft: UnitDraft): TranslationUnit {
  const protectedText = protectPlaceholders(draft.source);
  const encodedJsonSuffix =
    draft.constraints?.sourceEncoding === "json-stringified-json" && draft.constraints.encodedJsonPath
      ? `.$json.${draft.constraints.encodedJsonPath}`
      : "";
  return {
    id: `${path.basename(draft.relativeFilePath, path.extname(draft.relativeFilePath))}.${draft.jsonPath}${encodedJsonSuffix}`,
    source: draft.source,
    normalizedSource: protectedText.text,
    filePath: draft.relativeFilePath,
    jsonPath: draft.jsonPath,
    engine: draft.engine,
    category: draft.category,
    context: draft.context,
    constraints: draft.constraints,
    placeholders: protectedText.placeholders,
    hash: hashSource(draft.source)
  };
}

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

export function isTranslatableString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function decodeScriptStringLiteral(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function isSafeRuntimeText(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (/^\$game[A-Za-z]+\./.test(trimmed) || /^(?:true|false|null)$/i.test(trimmed)) {
    return false;
  }
  if (/^[\w./-]+\.(?:png|jpg|jpeg|webp|ogg|m4a|mp3|wav)$/i.test(trimmed)) {
    return false;
  }
  return containsTranslatableLetter(trimmed);
}

export function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
