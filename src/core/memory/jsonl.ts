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

import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "../utils/fs.js";
import type { MemoryEntry, TranslationMemory } from "./types.js";

// Memory is an append-only JSONL log: an upsert appends only the changed entries
// instead of rewriting the whole file, so a large memory is not fully rewritten
// on every batch. Duplicate keys are resolved last-wins on read. When the log
// grows large relative to the number of live entries it is compacted (rewritten
// without superseded lines) to keep reads and disk use bounded.
const COMPACTION_MIN_LINES = 512;
const COMPACTION_GROWTH_FACTOR = 2;

export type JsonlTranslationMemoryOptions = {
  compactionMinLines?: number;
  compactionGrowthFactor?: number;
};

export class JsonlTranslationMemory implements TranslationMemory {
  private cachedEntries?: Map<string, MemoryEntry>;
  private physicalLineCount = 0;
  private trailingNewline = true;
  private readonly compactionMinLines: number;
  private readonly compactionGrowthFactor: number;

  constructor(private readonly filePath: string, options: JsonlTranslationMemoryOptions = {}) {
    this.compactionMinLines = options.compactionMinLines ?? COMPACTION_MIN_LINES;
    this.compactionGrowthFactor = options.compactionGrowthFactor ?? COMPACTION_GROWTH_FACTOR;
  }

  async get(cacheKey: string): Promise<MemoryEntry | undefined> {
    return (await this.readAll()).get(cacheKey);
  }

  async upsert(entry: MemoryEntry): Promise<void> {
    await this.upsertMany([entry]);
  }

  async upsertMany(entriesToUpsert: MemoryEntry[]): Promise<void> {
    if (entriesToUpsert.length === 0) {
      return;
    }

    const entries = await this.readAll();
    const merged: MemoryEntry[] = [];
    for (const entry of entriesToUpsert) {
      const key = keyOf(entry);
      const existing = entries.get(key);
      const next: MemoryEntry = {
        ...entry,
        createdAt: existing?.createdAt ?? entry.createdAt,
        updatedAt: entry.updatedAt
      };
      entries.set(key, next);
      merged.push(next);
    }

    // Compact when the log has grown well past the number of live entries;
    // otherwise just append the changed entries to avoid rewriting the file.
    const prospectivePhysical = this.physicalLineCount + merged.length;
    if (
      prospectivePhysical > this.compactionMinLines &&
      prospectivePhysical > entries.size * this.compactionGrowthFactor
    ) {
      await this.writeAll(entries);
      return;
    }
    await this.appendEntries(merged);
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
        this.physicalLineCount = 0;
        this.trailingNewline = true;
        return this.cachedEntries;
      }
      throw error;
    }

    const entries = new Map<string, MemoryEntry>();
    let physical = 0;
    for (const line of raw.split(/\r?\n/)) {
      if (line.trim().length === 0) {
        continue;
      }
      // Tolerate corrupt lines (e.g. a truncated final line from a crash mid-write)
      // so a partially written memory file can still be reused instead of failing
      // the whole run.
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isMemoryEntry(parsed)) {
        continue;
      }
      entries.set(keyOf(parsed), parsed);
      physical += 1;
    }
    this.cachedEntries = entries;
    this.physicalLineCount = physical;
    this.trailingNewline = raw.length === 0 || raw.endsWith("\n");
    return entries;
  }

  private async appendEntries(entriesToAppend: MemoryEntry[]): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    // Guard against a previous truncated write that left the file without a
    // trailing newline, which would otherwise glue our first record onto it.
    const prefix = this.trailingNewline ? "" : "\n";
    const payload = entriesToAppend.map((entry) => JSON.stringify(entry)).join("\n");
    await appendFile(this.filePath, `${prefix}${payload}\n`, "utf8");
    this.physicalLineCount += entriesToAppend.length;
    this.trailingNewline = true;
  }

  private async writeAll(entries: Map<string, MemoryEntry>): Promise<void> {
    const payload = Array.from(entries.values())
      .map((entry) => JSON.stringify(entry))
      .join("\n");
    await writeFileAtomic(this.filePath, payload.length > 0 ? `${payload}\n` : "");
    this.cachedEntries = entries;
    this.physicalLineCount = entries.size;
    this.trailingNewline = true;
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
