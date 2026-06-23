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

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  Placeholder,
  ProviderUsage,
  ProviderUsageDetails,
  TranslationCategory,
  TranslationMetadata,
  TranslationResult,
  TranslationUnit,
  ValidationIssue
} from "../types.js";
import { writeFileAtomic } from "../utils/fs.js";

export type ImportedTranslation = {
  id: string;
  source: string;
  translation: string;
  provider?: string;
  model?: string;
  status?: TranslationResult["status"];
  issues?: ValidationIssue[];
  metadata?: TranslationMetadata;
};

export async function writeTranslationUnitsFile(filePath: string, units: TranslationUnit[]): Promise<void> {
  await writeFileAtomic(filePath, `${JSON.stringify(units, null, 2)}\n`);
}

export async function writeTranslationResultsFile(filePath: string, results: TranslationResult[]): Promise<void> {
  await writeFileAtomic(filePath, `${JSON.stringify(results, null, 2)}\n`);
}

export async function resetTranslationResultsJsonlFile(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, "", "utf8");
}

export async function appendTranslationResultsJsonlFile(
  filePath: string,
  results: TranslationResult[]
): Promise<void> {
  if (results.length === 0) {
    return;
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  const payload = results.map((result) => JSON.stringify(result)).join("\n");
  await writeFile(filePath, `${payload}\n`, { encoding: "utf8", flag: "a" });
}

export async function readTranslationResultsJsonlFile(filePath: string): Promise<TranslationResult[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  // Tolerate corrupt lines (e.g. a truncated final line left by a crash mid-append)
  // so a checkpoint can still resume from its readable entries instead of refusing
  // to load entirely.
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return [];
      }
      try {
        return normalizeTranslationResults([parsed]);
      } catch {
        return [];
      }
    });
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
      throw new Error(
        `Invalid translation unit at index ${index}: expected string id/source/filePath/jsonPath/hash, ` +
          "engine of rpgmaker-mv|rpgmaker-mz, a known category, and well-formed placeholders/constraints " +
          "(e.g. maxLength must be a number, not a string)"
      );
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

    const result: TranslationResult = {
      id: item.id,
      source: item.source,
      translation: item.translation,
      provider: item.provider ?? "manual-import",
      model: item.model ?? "manual",
      status: item.status ?? "translated"
    };

    if (item.issues != null) {
      result.issues = item.issues;
    }
    if (item.metadata != null) {
      result.metadata = item.metadata;
    }

    return result;
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
    (candidate.status == null || candidate.status === "translated" || candidate.status === "failed" || candidate.status === "skipped") &&
    (candidate.issues == null || (Array.isArray(candidate.issues) && candidate.issues.every(isValidationIssue))) &&
    (candidate.metadata == null || isTranslationMetadata(candidate.metadata))
  );
}

function isValidationIssue(value: unknown): value is ValidationIssue {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<Record<keyof ValidationIssue, unknown>>;
  return (
    (candidate.id == null || typeof candidate.id === "string") &&
    (candidate.severity === "info" || candidate.severity === "warning" || candidate.severity === "error") &&
    typeof candidate.code === "string" &&
    typeof candidate.message === "string"
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function isTranslationMetadata(value: unknown): value is TranslationMetadata {
  if (!isPlainObject(value)) {
    return false;
  }

  const candidate = value as Partial<TranslationMetadata>;
  return (
    (candidate.usage == null || isProviderUsage(candidate.usage)) &&
    (candidate.reviewed == null || typeof candidate.reviewed === "boolean") &&
    (candidate.repaired == null || typeof candidate.repaired === "boolean") &&
    (candidate.repairMode == null || candidate.repairMode === "translate" || candidate.repairMode === "review") &&
    (candidate.fromMemory == null || typeof candidate.fromMemory === "boolean") &&
    (candidate.fromCheckpoint == null || typeof candidate.fromCheckpoint === "boolean")
  );
}

function isProviderUsage(value: unknown): value is ProviderUsage {
  if (!isPlainObject(value)) {
    return false;
  }

  const candidate = value as Partial<ProviderUsage>;
  return (
    optionalNumber(candidate.prompt_tokens) &&
    optionalNumber(candidate.completion_tokens) &&
    optionalNumber(candidate.total_tokens) &&
    (candidate.prompt_tokens_details == null || isProviderUsageDetails(candidate.prompt_tokens_details)) &&
    (candidate.completion_tokens_details == null || isProviderUsageDetails(candidate.completion_tokens_details)) &&
    optionalNumber(candidate.prompt_cache_hit_tokens) &&
    optionalNumber(candidate.prompt_cache_miss_tokens)
  );
}

function isProviderUsageDetails(value: unknown): value is ProviderUsageDetails {
  if (!isPlainObject(value)) {
    return false;
  }

  const candidate = value as Partial<ProviderUsageDetails>;
  return optionalNumber(candidate.cached_tokens);
}

function optionalNumber(value: unknown): boolean {
  return value == null || typeof value === "number";
}

const TRANSLATION_CATEGORIES: ReadonlySet<TranslationCategory> = new Set<TranslationCategory>([
  "dialogue",
  "choice",
  "name",
  "description",
  "system",
  "plugin-parameter",
  "unknown"
]);

const PLACEHOLDER_KINDS: ReadonlySet<Placeholder["kind"]> = new Set<Placeholder["kind"]>([
  "control-code",
  "format-token",
  "template-token",
  "tag"
]);

function isTranslationUnit(value: unknown): value is TranslationUnit {
  if (!isPlainObject(value)) {
    return false;
  }

  const candidate = value as Partial<Record<keyof TranslationUnit, unknown>>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.source === "string" &&
    (candidate.normalizedSource == null || typeof candidate.normalizedSource === "string") &&
    typeof candidate.filePath === "string" &&
    typeof candidate.jsonPath === "string" &&
    (candidate.engine === "rpgmaker-mv" || candidate.engine === "rpgmaker-mz") &&
    typeof candidate.category === "string" &&
    TRANSLATION_CATEGORIES.has(candidate.category as TranslationCategory) &&
    typeof candidate.hash === "string" &&
    (candidate.context == null || isPlainObject(candidate.context)) &&
    (candidate.placeholders == null || isPlaceholderArray(candidate.placeholders)) &&
    (candidate.constraints == null || isUnitConstraints(candidate.constraints))
  );
}

function isPlaceholderArray(value: unknown): boolean {
  return Array.isArray(value) && value.every(isPlaceholder);
}

function isPlaceholder(value: unknown): value is Placeholder {
  if (!isPlainObject(value)) {
    return false;
  }
  const candidate = value as Partial<Record<keyof Placeholder, unknown>>;
  return (
    typeof candidate.token === "string" &&
    typeof candidate.value === "string" &&
    typeof candidate.required === "boolean" &&
    typeof candidate.kind === "string" &&
    PLACEHOLDER_KINDS.has(candidate.kind as Placeholder["kind"])
  );
}

function isUnitConstraints(value: unknown): boolean {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    optionalBoolean(value.preserveNewlines) &&
    optionalBoolean(value.preserveControlCodes) &&
    optionalNumber(value.maxLines) &&
    optionalNumber(value.maxLength) &&
    (value.sourceEncoding == null ||
      value.sourceEncoding === "json-string-literal" ||
      value.sourceEncoding === "json-stringified-json") &&
    (value.encodedJsonPath == null || typeof value.encodedJsonPath === "string") &&
    (value.encodedJsonSegments == null || isStringArray(value.encodedJsonSegments))
  );
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function optionalBoolean(value: unknown): boolean {
  return value == null || typeof value === "boolean";
}
