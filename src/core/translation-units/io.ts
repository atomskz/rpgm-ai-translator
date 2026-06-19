import { readFile, writeFile } from "node:fs/promises";
import type { TranslationResult, TranslationUnit } from "../types.js";

export type ImportedTranslation = {
  id: string;
  source: string;
  translation: string;
  provider?: string;
  model?: string;
  status?: TranslationResult["status"];
};

export async function writeTranslationUnitsFile(filePath: string, units: TranslationUnit[]): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(units, null, 2)}\n`, "utf8");
}

export async function writeTranslationResultsFile(filePath: string, results: TranslationResult[]): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
}

export async function readTranslationUnitsFile(filePath: string): Promise<TranslationUnit[]> {
  const raw = await readFile(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    throw new Error(`Invalid units JSON in '${filePath}': ${error instanceof Error ? error.message : String(error)}`, {
      cause: error
    });
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Units file must contain a JSON array");
  }

  parsed.forEach((item, index) => {
    if (!isTranslationUnit(item)) {
      throw new Error(`Invalid translation unit at index ${index}: expected id, source, filePath, jsonPath, engine, category and hash`);
    }
  });

  return parsed;
}

export async function readTranslationResultsFile(filePath: string): Promise<TranslationResult[]> {
  const raw = await readFile(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    throw new Error(`Invalid translations JSON in '${filePath}': ${error instanceof Error ? error.message : String(error)}`, {
      cause: error
    });
  }

  return normalizeTranslationResults(parsed);
}

export function normalizeTranslationResults(value: unknown): TranslationResult[] {
  if (!Array.isArray(value)) {
    throw new Error("Translations file must contain a JSON array");
  }

  return value.map((item, index) => {
    if (!isImportedTranslation(item)) {
      throw new Error(`Invalid translation entry at index ${index}: expected id, source and translation strings`);
    }

    return {
      id: item.id,
      source: item.source,
      translation: item.translation,
      provider: item.provider ?? "manual-import",
      model: item.model ?? "manual",
      status: item.status ?? "translated"
    };
  });
}

function isImportedTranslation(value: unknown): value is ImportedTranslation {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<Record<keyof ImportedTranslation, unknown>>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.source === "string" &&
    typeof candidate.translation === "string" &&
    (candidate.provider == null || typeof candidate.provider === "string") &&
    (candidate.model == null || typeof candidate.model === "string") &&
    (candidate.status == null || candidate.status === "translated" || candidate.status === "failed" || candidate.status === "skipped")
  );
}

function isTranslationUnit(value: unknown): value is TranslationUnit {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<Record<keyof TranslationUnit, unknown>>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.source === "string" &&
    typeof candidate.filePath === "string" &&
    typeof candidate.jsonPath === "string" &&
    (candidate.engine === "rpgmaker-mv" || candidate.engine === "rpgmaker-mz") &&
    typeof candidate.category === "string" &&
    typeof candidate.hash === "string"
  );
}
