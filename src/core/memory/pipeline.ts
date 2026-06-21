import { normalizeBatchSize } from "../batching/index.js";
import type { LLMProvider, TranslateOptions, TranslationResult, TranslationUnit } from "../types.js";
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

  const resultsByUnitId = new Map<string, TranslationResult>();
  const missesByHash = new Map<string, TranslationUnit>();
  const missedUnitsByHash = new Map<string, TranslationUnit[]>();
  let memoryCompleted = 0;

  for (const unit of units) {
    const cached = await memory.get(unit.hash);
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

    if (!missesByHash.has(unit.hash)) {
      missesByHash.set(unit.hash, unit);
    }
    const missedUnits = missedUnitsByHash.get(unit.hash) ?? [];
    missedUnits.push(unit);
    missedUnitsByHash.set(unit.hash, missedUnits);
  }

  const optionsWithExpandedBatchResults = expandBatchResultsForDuplicateMisses(
    options,
    missesByHash,
    missedUnitsByHash
  );
  const translatedMisses =
    missesByHash.size > 0
      ? await translateUniqueBatches(Array.from(missesByHash.values()), provider, optionsWithExpandedBatchResults)
      : [];
  const translatedByHash = new Map<string, TranslationResult>();
  const memoryEntriesToUpsert: MemoryEntry[] = [];

  for (const result of translatedMisses) {
    const unit = missesByHash.get(hashForResult(result, missesByHash));
    if (!unit) {
      continue;
    }
    translatedByHash.set(unit.hash, result);
    if (result.status === "translated") {
      memoryEntriesToUpsert.push(toMemoryEntry(unit, result));
    }
  }
  await upsertMemoryEntries(memory, memoryEntriesToUpsert);

  for (const unit of units) {
    if (resultsByUnitId.has(unit.id)) {
      continue;
    }

    const translated = translatedByHash.get(unit.hash);
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
  missesByHash: Map<string, TranslationUnit>,
  missedUnitsByHash: Map<string, TranslationUnit[]>
): TranslateOptions {
  const originalOnBatchResults = options.onBatchResults;
  if (!originalOnBatchResults) {
    return options;
  }

  return {
    ...options,
    onBatchResults: async (batchResults) => {
      const expandedResults = batchResults.flatMap((result) => {
        const unit = missesByHash.get(hashForResult(result, missesByHash));
        if (!unit) {
          return [result];
        }
        return (missedUnitsByHash.get(unit.hash) ?? [unit]).map((missedUnit) => ({
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

function hashForResult(result: TranslationResult, missesByHash: Map<string, TranslationUnit>): string {
  for (const [hash, unit] of missesByHash.entries()) {
    if (unit.id === result.id) {
      return hash;
    }
  }
  return "";
}

function toMemoryEntry(unit: TranslationUnit, result: TranslationResult): MemoryEntry {
  const now = new Date().toISOString();
  return {
    source: unit.source,
    sourceHash: unit.hash,
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
