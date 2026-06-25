import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import type { TranslationResult, TranslationUnit } from "../../src/core/types/types.js";

export async function createCliTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

export async function writeJsonFixture(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeJsonlFixture(filePath: string, entries: unknown[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
}

export function actorNameUnit(overrides: Partial<TranslationUnit> = {}): TranslationUnit {
  return {
    id: "Actors.1.name",
    source: "Aria",
    normalizedSource: "Aria",
    filePath: "data/Actors.json",
    jsonPath: "1.name",
    engine: "rpgmaker-mv",
    category: "name",
    hash: "hash",
    ...overrides
  };
}

export function dialogueUnit(overrides: Partial<TranslationUnit> = {}): TranslationUnit {
  return {
    id: "Map001.events.1.pages.0.list.0.parameters.0",
    source: "I am ready.",
    normalizedSource: "I am ready.",
    filePath: "data/Map001.json",
    jsonPath: "events.1.pages.0.list.0.parameters.0",
    engine: "rpgmaker-mz",
    category: "dialogue",
    hash: "hash",
    ...overrides
  };
}

export function translatedResult(overrides: Partial<TranslationResult> = {}): TranslationResult {
  return {
    id: "Actors.1.name",
    source: "Aria",
    translation: "Ария",
    provider: "manual",
    model: "manual",
    status: "translated",
    ...overrides
  };
}
