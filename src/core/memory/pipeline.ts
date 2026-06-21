import { normalizeBatchSize } from "../batching/index.js";
import type { LLMProvider, TranslateOptions, TranslationResult, TranslationUnit } from "../types.js";
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
    }
    const missedUnits = missedUnitsByKey.get(cacheKey) ?? [];
    missedUnits.push(unit);
    missedUnitsByKey.set(cacheKey, missedUnits);
  }

  const optionsWithExpandedBatchResults = expandBatchResultsForDuplicateMisses(
    options,
    missesByKey,
    missedUnitsByKey
  );
  const translatedMisses =
    missesByKey.size > 0
      ? await translateUniqueBatches(Array.from(missesByKey.values()), provider, optionsWithExpandedBatchResults)
      : [];
  const translatedByKey = new Map<string, TranslationResult>();
  const memoryEntriesToUpsert: MemoryEntry[] = [];

  for (const result of translatedMisses) {
    const cacheKey = keyForResult(result, missesByKey);
    const unit = cacheKey ? missesByKey.get(cacheKey) : undefined;
    if (!unit) {
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
      total: units.length
    });
  }

  return results;
}

function expandBatchResultsForDuplicateMisses(
  options: TranslateOptions,
  missesByKey: Map<string, TranslationUnit>,
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
        const cacheKey = keyForResult(result, missesByKey);
        const missedUnits = cacheKey ? missedUnitsByKey.get(cacheKey) : undefined;
        if (!missedUnits) {
          return [result];
        }
        return missedUnits.map((missedUnit) => ({
          ...result,
          id: missedUnit.id,
          source: missedUnit.source
        }));
      });
      await originalOnBatchResults(expandedResults);
    }
  };
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

function keyForResult(result: TranslationResult, missesByKey: Map<string, TranslationUnit>): string {
  for (const [cacheKey, unit] of missesByKey.entries()) {
    if (unit.id === result.id) {
      return cacheKey;
    }
  }
  return "";
}

/**
 * Builds the memory/dedup key for a unit. It deliberately folds the target and
 * source languages, the unit's layout constraints, the surrounding context and
 * the active glossary into the digest so that a cached translation is only
 * reused when every input that shaped it is identical. Keying on the source
 * text alone reused translations across languages and collapsed units that
 * happened to share a source string but had different constraints/context.
 */
export function translationCacheKey(unit: TranslationUnit, options: TranslateOptions): string {
  return hashCacheKey({
    source: unit.source,
    category: unit.category,
    targetLanguage: options.targetLanguage ?? "",
    sourceLanguage: options.sourceLanguage ?? "",
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
