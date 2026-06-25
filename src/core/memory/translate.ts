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

import { normalizeBatchSize } from "../batching.js";
import { summarizeBatchFailures } from "../reports/failures.js";
import type { LLMProvider, TranslateOptions, TranslationMetadata, TranslationResult, TranslationUnit } from "../types/types.js";
import { hashCacheKey } from "../utils/hash.js";
import { translateBatchWithRetry } from "./retry.js";
import type { MemoryEntry, TranslationMemory } from "./types.js";

export async function translateWithMemory(
  units: TranslationUnit[],
  provider: LLMProvider,
  options: TranslateOptions,
  memory?: TranslationMemory
): Promise<TranslationResult[]> {
  if (!memory) {
    return translateUniqueBatches(units, provider, options);
  }

  const cacheKeyByUnitId = new Map(units.map((unit) => [unit.id, translationCacheKey(unit, options)]));
  const cacheKeyFor = (unit: TranslationUnit): string =>
    cacheKeyByUnitId.get(unit.id) ?? translationCacheKey(unit, options);

  const resultsByUnitId = new Map<string, TranslationResult>();
  const missesByKey = new Map<string, TranslationUnit>();
  const missedUnitsByKey = new Map<string, TranslationUnit[]>();
  // Reverse index from a representative miss unit's id to its cache key, so a
  // batch result is matched back to its key in O(1) instead of scanning all
  // misses for every result (which was O(misses * results)).
  const keyByRepresentativeId = new Map<string, string>();
  let memoryCompleted = 0;

  for (const unit of units) {
    const cacheKey = cacheKeyFor(unit);
    const cached = await memory.get(cacheKey);
    if (cached && cached.status === "translated") {
      resultsByUnitId.set(unit.id, {
        id: unit.id,
        source: unit.source,
        translation: cached.translation,
        provider: cached.provider,
        model: cached.model,
        status: "translated",
        metadata: { fromMemory: true }
      });
      memoryCompleted += 1;
      options.onProgress?.({
        type: "memory-hit",
        completed: memoryCompleted,
        total: units.length,
        unitId: unit.id
      });
      continue;
    }

    if (!missesByKey.has(cacheKey)) {
      missesByKey.set(cacheKey, unit);
      keyByRepresentativeId.set(unit.id, cacheKey);
    }
    const missedUnits = missedUnitsByKey.get(cacheKey) ?? [];
    missedUnits.push(unit);
    missedUnitsByKey.set(cacheKey, missedUnits);
  }

  const optionsWithExpandedBatchResults = expandBatchResultsForDuplicateMisses(
    options,
    keyByRepresentativeId,
    missedUnitsByKey
  );
  const translatedMisses =
    missesByKey.size > 0
      ? await translateUniqueBatches(Array.from(missesByKey.values()), provider, optionsWithExpandedBatchResults)
      : [];
  const translatedByKey = new Map<string, TranslationResult>();
  const memoryEntriesToUpsert: MemoryEntry[] = [];

  for (const result of translatedMisses) {
    const cacheKey = cacheKeyForResult(result, keyByRepresentativeId);
    const unit = cacheKey ? missesByKey.get(cacheKey) : undefined;
    if (!cacheKey || !unit) {
      continue;
    }
    translatedByKey.set(cacheKey, result);
    if (result.status === "translated") {
      memoryEntriesToUpsert.push(toMemoryEntry(unit, result, cacheKey, options));
    }
  }
  await upsertMemoryEntries(memory, memoryEntriesToUpsert);

  for (const unit of units) {
    if (resultsByUnitId.has(unit.id)) {
      continue;
    }

    const translated = translatedByKey.get(cacheKeyFor(unit));
    if (translated) {
      resultsByUnitId.set(unit.id, {
        ...translated,
        id: unit.id,
        source: unit.source
      });
    }
  }

  return units.map((unit) => {
    const result = resultsByUnitId.get(unit.id);
    if (!result) {
      return missingTranslationResult(unit, provider, options);
    }
    return result;
  });
}

async function translateUniqueBatches(
  units: TranslationUnit[],
  provider: LLMProvider,
  options: TranslateOptions
): Promise<TranslationResult[]> {
  const batchSize = normalizeBatchSize(options.batchSize);
  const results: TranslationResult[] = [];
  const batchCount = Math.ceil(units.length / batchSize);
  let completed = 0;

  for (let index = 0; index < units.length; index += batchSize) {
    const batch = units.slice(index, index + batchSize);
    const batchIndex = Math.floor(index / batchSize) + 1;
    options.onProgress?.({
      type: "batch-start",
      batchIndex,
      batchCount,
      batchSize: batch.length,
      completed,
      total: units.length
    });
    const batchResults = await translateBatchWithRetry(batch, provider, options, batchIndex, batchCount);
    results.push(...batchResults);
    await options.onBatchResults?.(batchResults);
    completed += batch.length;
    options.onProgress?.({
      type: "batch-complete",
      batchIndex,
      batchCount,
      batchSize: batch.length,
      translated: batchResults.filter((result) => result.status === "translated").length,
      failed: batchResults.filter((result) => result.status === "failed").length,
      completed,
      total: units.length,
      failures: summarizeBatchFailures(batchResults)
    });
  }

  return results;
}

function expandBatchResultsForDuplicateMisses(
  options: TranslateOptions,
  keyByRepresentativeId: Map<string, string>,
  missedUnitsByKey: Map<string, TranslationUnit[]>
): TranslateOptions {
  const originalOnBatchResults = options.onBatchResults;
  if (!originalOnBatchResults) {
    return options;
  }

  return {
    ...options,
    onBatchResults: async (batchResults) => {
      const expandedResults = batchResults.flatMap((result) => {
        const cacheKey = cacheKeyForResult(result, keyByRepresentativeId);
        const missedUnits = cacheKey ? missedUnitsByKey.get(cacheKey) : undefined;
        if (!missedUnits) {
          return [result];
        }
        // The batch usage rides on a single result. Copying it onto every
        // duplicate-source sibling would multiply the recorded cost once these
        // are read back from a file (where the in-process identity dedup is
        // lost), so only the first copy keeps it.
        return missedUnits.map((missedUnit, index) => ({
          ...result,
          id: missedUnit.id,
          source: missedUnit.source,
          metadata: index === 0 ? result.metadata : withoutUsage(result.metadata)
        }));
      });
      await originalOnBatchResults(expandedResults);
    }
  };
}

// Drops the batch-level usage from a copied result so a duplicate-source sibling
// does not re-count tokens the original already accounts for. Returns the same
// metadata untouched when it carries no usage, and undefined when nothing remains.
function withoutUsage(metadata: TranslationMetadata | undefined): TranslationMetadata | undefined {
  if (!metadata || (metadata.usage == null && metadata.tokenUsage == null)) {
    return metadata;
  }
  const rest = { ...metadata };
  delete rest.usage;
  delete rest.tokenUsage;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

async function upsertMemoryEntries(memory: TranslationMemory, entries: MemoryEntry[]): Promise<void> {
  if (memory.upsertMany) {
    await memory.upsertMany(entries);
    return;
  }

  for (const entry of entries) {
    await memory.upsert(entry);
  }
}

function cacheKeyForResult(result: TranslationResult, keyByRepresentativeId: Map<string, string>): string | undefined {
  return keyByRepresentativeId.get(result.id);
}

/**
 * Builds the memory/dedup key for a unit. It deliberately folds the target and
 * source languages, the model, the unit's layout constraints, the surrounding
 * context and the active glossary into the digest so that a cached translation
 * is only reused when every input that shaped it is identical. Keying on the
 * source text alone reused translations across languages and collapsed units
 * that happened to share a source string but had different constraints/context;
 * omitting the model replayed a weaker model's output after an upgrade.
 */
export function translationCacheKey(unit: TranslationUnit, options: TranslateOptions): string {
  return hashCacheKey({
    source: unit.source,
    category: unit.category,
    targetLanguage: options.targetLanguage ?? "",
    sourceLanguage: options.sourceLanguage ?? "",
    model: options.model ?? "",
    constraints: unit.constraints ?? {},
    context: unit.context ?? {},
    glossary: options.glossary ?? null
  });
}

function toMemoryEntry(
  unit: TranslationUnit,
  result: TranslationResult,
  cacheKey: string,
  options: TranslateOptions
): MemoryEntry {
  const now = new Date().toISOString();
  return {
    source: unit.source,
    sourceHash: unit.hash,
    cacheKey,
    targetLanguage: options.targetLanguage,
    translation: result.translation,
    category: unit.category,
    context: unit.context,
    provider: result.provider,
    model: result.model,
    status: result.status,
    createdAt: now,
    updatedAt: now
  };
}

function missingTranslationResult(
  unit: TranslationUnit,
  provider: LLMProvider,
  options: TranslateOptions
): TranslationResult {
  return {
    id: unit.id,
    source: unit.source,
    translation: "",
    provider: provider.name,
    model: options.model ?? "unknown",
    status: "failed",
    issues: [
      {
        id: unit.id,
        severity: "error",
        code: "MISSING_TRANSLATION",
        message: "Translation was not produced"
      }
    ]
  };
}
