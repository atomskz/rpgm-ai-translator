import type { TranslationCategory, TranslationUnit } from "../types.js";

export type MemoryEntry = {
  source: string;
  sourceHash: string;
  /**
   * Composite lookup key. Unlike `sourceHash` it also folds in the target
   * language, glossary, constraints and context so that the same source string
   * is not reused across languages or incompatible layout constraints. Optional
   * for backward compatibility with memory files written before this field
   * existed; such entries fall back to `sourceHash` and therefore simply miss.
   */
  cacheKey?: string;
  targetLanguage?: string;
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
