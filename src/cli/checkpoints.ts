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

import { readFile } from "node:fs/promises";
import {
  readTranslationResultsJsonlFile,
  resetTranslationResultsJsonlFile
} from "../core/translation-units/index.js";
import type { CharacterGlossary, Glossary, TranslationResult, TranslationUnit } from "../core/types.js";
import { writeFileAtomic } from "../core/utils/fs.js";
import { hashCacheKey } from "../core/utils/hash.js";

export function defaultCheckpointPath(outPath: string): string {
  return outPath.endsWith(".json") ? `${outPath.slice(0, -".json".length)}.jsonl` : `${outPath}.jsonl`;
}

// Identity of the run that produced a checkpoint. A checkpoint records only the
// source text per result, so resuming after the target language, model, provider
// or glossary changed would silently ship stale output (e.g. the previous
// language). The signature is written beside the checkpoint and compared on
// resume; a mismatch means the checkpoint must be discarded, not reused.
export type CheckpointSignature = {
  targetLanguage: string;
  provider: string;
  model: string;
  glossaryHash: string;
};

export function checkpointSignature(
  providerName: string,
  options: { targetLanguage?: string; model?: string },
  glossary?: Glossary,
  characterGlossary?: CharacterGlossary
): CheckpointSignature {
  return {
    targetLanguage: options.targetLanguage ?? "",
    provider: providerName,
    model: options.model ?? "",
    glossaryHash: hashCacheKey({ glossary: glossary ?? null, characterGlossary: characterGlossary ?? null })
  };
}

export function checkpointSignaturesEqual(a: CheckpointSignature, b: CheckpointSignature): boolean {
  return (
    a.targetLanguage === b.targetLanguage &&
    a.provider === b.provider &&
    a.model === b.model &&
    a.glossaryHash === b.glossaryHash
  );
}

export function checkpointMetaPath(checkpointPath: string): string {
  return `${checkpointPath}.meta.json`;
}

// Reads a checkpoint signature, returning undefined when it is absent or
// unreadable. A missing signature (a checkpoint from an older build or one
// hand-authored in tests) is treated as "no information": the caller resumes for
// backward compatibility and then stamps a fresh signature for next time.
export async function readCheckpointSignatureFile(metaPath: string): Promise<CheckpointSignature | undefined> {
  let raw: string;
  try {
    raw = await readFile(metaPath, "utf8");
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<CheckpointSignature>;
    if (
      typeof parsed.targetLanguage === "string" &&
      typeof parsed.provider === "string" &&
      typeof parsed.model === "string" &&
      typeof parsed.glossaryHash === "string"
    ) {
      return parsed as CheckpointSignature;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function writeCheckpointSignatureFile(metaPath: string, signature: CheckpointSignature): Promise<void> {
  await writeFileAtomic(metaPath, `${JSON.stringify(signature, null, 2)}\n`);
}

export type ResolvedCheckpoint = {
  checkpointPath: string;
  /** Results to seed resume; empty when the checkpoint is derived or stale. */
  results: TranslationResult[];
  /** An explicit --checkpoint was discarded because its signature no longer matches. */
  stale: boolean;
  /** An explicit --checkpoint is being resumed (compatible or unsigned). */
  resumed: boolean;
};

// Resolves where the JSONL checkpoint lives and gates resume on the run
// signature. An explicit --checkpoint written for a different language, model,
// provider or glossary is discarded rather than silently reused (which would
// ship stale output such as the previous language); a derived checkpoint (no
// --checkpoint) is reset every run. Either way a fresh signature is stamped
// beside the resolved path. translate/run/review/repair all funnel through this
// so no command can resume an incompatible checkpoint.
export async function resolveCheckpoint(params: {
  checkpointOption: string | undefined;
  derivedPath: string;
  signature: CheckpointSignature;
}): Promise<ResolvedCheckpoint> {
  const { checkpointOption, derivedPath, signature } = params;
  const checkpointPath = checkpointOption ?? derivedPath;
  let results: TranslationResult[] = [];
  let stale = false;
  let resumed = false;
  if (checkpointOption) {
    const previousSignature = await readCheckpointSignatureFile(checkpointMetaPath(checkpointOption));
    stale = previousSignature != null && !checkpointSignaturesEqual(previousSignature, signature);
    if (stale) {
      await resetTranslationResultsJsonlFile(checkpointOption);
    } else {
      results = await readTranslationResultsJsonlFile(checkpointOption);
      resumed = true;
    }
    // Stamp the signature only for an explicit checkpoint, which is the only one
    // resumed (and therefore signature-checked) on a later run.
    await writeCheckpointSignatureFile(checkpointMetaPath(checkpointPath), signature);
  } else {
    // A derived checkpoint is reset every run and never resumed across runs, so a
    // signature beside it would only ever be written, never read.
    await resetTranslationResultsJsonlFile(derivedPath);
  }
  return { checkpointPath, results, stale, resumed };
}

export function checkpointedTranslationsById(
  units: TranslationUnit[],
  checkpointResults: TranslationResult[]
): Map<string, TranslationResult> {
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  const resultsById = new Map<string, TranslationResult>();

  for (const result of checkpointResults) {
    const unit = unitsById.get(result.id);
    if (!unit || result.status !== "translated" || result.source !== unit.source) {
      continue;
    }
    resultsById.set(result.id, { ...result, metadata: { ...result.metadata, fromCheckpoint: true } });
  }

  return resultsById;
}

export function mergeCheckpointTranslations(
  units: TranslationUnit[],
  translations: TranslationResult[],
  checkpointById: Map<string, TranslationResult>
): TranslationResult[] {
  const translationsById = new Map(translations.map((translation) => [translation.id, translation]));
  const unitIds = new Set(units.map((unit) => unit.id));
  const merged = units
    .map((unit) => checkpointById.get(unit.id) ?? translationsById.get(unit.id))
    .filter((translation): translation is TranslationResult => translation != null);
  return merged.concat(translations.filter((translation) => !unitIds.has(translation.id)));
}

export function missingCheckpointResult(
  unit: TranslationUnit,
  providerName: string,
  model: string | undefined
): TranslationResult {
  return {
    id: unit.id,
    source: unit.source,
    translation: "",
    provider: providerName,
    model: model ?? "unknown",
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
