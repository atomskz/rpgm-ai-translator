import type { TranslationCategory, TranslationUnit } from "../types.js";

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
