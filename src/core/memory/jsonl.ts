import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MemoryEntry, TranslationMemory } from "./types.js";

export class JsonlTranslationMemory implements TranslationMemory {
  private cachedEntries?: Map<string, MemoryEntry>;

  constructor(private readonly filePath: string) {}

  async get(cacheKey: string): Promise<MemoryEntry | undefined> {
    return (await this.readAll()).get(cacheKey);
  }

  async upsert(entry: MemoryEntry): Promise<void> {
    const entries = await this.readAll();
    const key = keyOf(entry);
    const existing = entries.get(key);
    entries.set(key, {
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
      const key = keyOf(entry);
      const existing = entries.get(key);
      entries.set(key, {
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
        entries.set(keyOf(parsed), parsed);
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

function keyOf(entry: MemoryEntry): string {
  return entry.cacheKey ?? entry.sourceHash;
}

function isMemoryEntry(value: unknown): value is MemoryEntry {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<Record<keyof MemoryEntry, unknown>>;
  return (
    typeof candidate.source === "string" &&
    typeof candidate.sourceHash === "string" &&
    (candidate.cacheKey == null || typeof candidate.cacheKey === "string") &&
    (candidate.targetLanguage == null || typeof candidate.targetLanguage === "string") &&
    typeof candidate.translation === "string" &&
    typeof candidate.category === "string" &&
    typeof candidate.provider === "string" &&
    typeof candidate.model === "string" &&
    (candidate.status === "translated" || candidate.status === "failed" || candidate.status === "skipped") &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string"
  );
}
