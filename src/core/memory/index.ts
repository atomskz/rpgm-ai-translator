import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LLMProvider, TranslateOptions, TranslationCategory, TranslationResult, TranslationUnit } from "../types.js";

export type MemoryEntry = {
  source: string;
  sourceHash: string;
  translation: string;
  category: TranslationCategory;
  context?: TranslationUnit["context"];
  provider: string;
  model: string;
  status: "translated" | "failed" | "skipped";
  createdAt: string;
  updatedAt: string;
};

export interface TranslationMemory {
  get(sourceHash: string): Promise<MemoryEntry | undefined>;
  upsert(entry: MemoryEntry): Promise<void>;
  upsertMany?(entries: MemoryEntry[]): Promise<void>;
}

export class JsonlTranslationMemory implements TranslationMemory {
  private cachedEntries?: Map<string, MemoryEntry>;

  constructor(private readonly filePath: string) {}

  async get(sourceHash: string): Promise<MemoryEntry | undefined> {
    return (await this.readAll()).get(sourceHash);
  }

  async upsert(entry: MemoryEntry): Promise<void> {
    const entries = await this.readAll();
    const existing = entries.get(entry.sourceHash);
    entries.set(entry.sourceHash, {
      ...entry,
      createdAt: existing?.createdAt ?? entry.createdAt,
      updatedAt: entry.updatedAt
    });
    await this.writeAll(entries);
  }

  async upsertMany(entriesToUpsert: MemoryEntry[]): Promise<void> {
    if (entriesToUpsert.length === 0) {
      return;
    }

    const entries = await this.readAll();
    for (const entry of entriesToUpsert) {
      const existing = entries.get(entry.sourceHash);
      entries.set(entry.sourceHash, {
        ...entry,
        createdAt: existing?.createdAt ?? entry.createdAt,
        updatedAt: entry.updatedAt
      });
    }
    await this.writeAll(entries);
  }

  private async readAll(): Promise<Map<string, MemoryEntry>> {
    if (this.cachedEntries) {
      return this.cachedEntries;
    }

    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        this.cachedEntries = new Map();
        return this.cachedEntries;
      }
      throw error;
    }

    const entries = new Map<string, MemoryEntry>();
    raw
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .forEach((line, index) => {
        const parsed = JSON.parse(line) as unknown;
        if (!isMemoryEntry(parsed)) {
          throw new Error(`Invalid memory entry at line ${index + 1}`);
        }
        entries.set(parsed.sourceHash, parsed);
      });
    this.cachedEntries = entries;
    return entries;
  }

  private async writeAll(entries: Map<string, MemoryEntry>): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const payload = Array.from(entries.values())
      .map((entry) => JSON.stringify(entry))
      .join("\n");
    await writeFile(this.filePath, payload.length > 0 ? `${payload}\n` : "", "utf8");
    this.cachedEntries = entries;
  }
}

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

  const originalOnBatchResults = options.onBatchResults;
  const optionsWithExpandedBatchResults: TranslateOptions = originalOnBatchResults
    ? {
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
      }
    : options;

  const translatedMisses =
    missesByHash.size > 0 ? await translateUniqueBatches(Array.from(missesByHash.values()), provider, optionsWithExpandedBatchResults) : [];
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
  if (memory.upsertMany) {
    await memory.upsertMany(memoryEntriesToUpsert);
  } else {
    for (const entry of memoryEntriesToUpsert) {
      await memory.upsert(entry);
    }
  }

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

async function translateBatchWithRetry(
  batch: TranslationUnit[],
  provider: LLMProvider,
  options: TranslateOptions,
  batchIndex: number,
  batchCount: number
): Promise<TranslationResult[]> {
  const attempts = options.retryAttempts ?? 1;
  let lastError: unknown;

  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    try {
      return await provider.translateBatch(batch, options);
    } catch (error: unknown) {
      lastError = error;
      if (attempt < attempts) {
        options.onProgress?.({
          type: "batch-retry",
          batchIndex,
          batchCount,
          attempt: attempt + 1,
          maxAttempts: attempts + 1,
          message: error instanceof Error ? error.message : String(error)
        });
        await sleep(options.retryDelayMs ?? 250);
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  return batch.map((unit) => ({
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
        message: `Translation batch failed: ${message}`
      }
    ]
  }));
}

function normalizeBatchSize(batchSize: number | undefined): number {
  if (batchSize == null || !Number.isFinite(batchSize) || batchSize < 1) {
    return 20;
  }
  return Math.floor(batchSize);
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

function isMemoryEntry(value: unknown): value is MemoryEntry {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<Record<keyof MemoryEntry, unknown>>;
  return (
    typeof candidate.source === "string" &&
    typeof candidate.sourceHash === "string" &&
    typeof candidate.translation === "string" &&
    typeof candidate.category === "string" &&
    typeof candidate.provider === "string" &&
    typeof candidate.model === "string" &&
    (candidate.status === "translated" || candidate.status === "failed" || candidate.status === "skipped") &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string"
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
