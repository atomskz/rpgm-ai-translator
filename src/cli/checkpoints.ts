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
} from "../core/translation-units.js";
import { PROMPT_VERSION } from "../core/prompt-version.js";
import type { CharacterGlossary, Glossary, TranslationResult, TranslationUnit } from "../core/types/public-api.js";
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
//
// `gameId` identifies the source game (resolved project path + engine). The
// default work dir is derived from --out alone, so two different games translated
// into the same --out would otherwise share checkpoints and translation memory;
// a differing gameId trips the discard path so one game's output never bleeds
// into another. It is empty for the unit-file commands (translate/review/repair)
// that operate on a units.json rather than a game directory.
//
// `inputsHash` folds the remaining output-shaping settings that the per-result
// source-equality gate cannot see: sampling (temperature, maxTokens, batchSize)
// and, for the run pipeline, the extraction flags (includePlugins,
// includeSpeakerNames, includeEventComments, dialogueMaxLength). Changing any of
// them and re-running would otherwise resume translations produced under the old
// settings; a differing inputsHash discards them instead.
export type CheckpointSignature = {
  targetLanguage: string;
  provider: string;
  model: string;
  glossaryHash: string;
  gameId: string;
  inputsHash: string;
};

export function checkpointSignature(
  providerName: string,
  options: { targetLanguage?: string; model?: string; temperature?: number; maxTokens?: number; batchSize?: number },
  glossary?: Glossary,
  characterGlossary?: CharacterGlossary,
  context?: { gameId?: string; extractionFlagsHash?: string }
): CheckpointSignature {
  return {
    targetLanguage: options.targetLanguage ?? "",
    provider: providerName,
    model: options.model ?? "",
    glossaryHash: hashCacheKey({ glossary: glossary ?? null, characterGlossary: characterGlossary ?? null }),
    gameId: context?.gameId ?? "",
    inputsHash: hashCacheKey({
      temperature: options.temperature ?? null,
      maxTokens: options.maxTokens ?? null,
      batchSize: options.batchSize ?? null,
      extractionFlags: context?.extractionFlagsHash ?? "",
      // Fold the prompt version in so editing the prompts (and bumping the
      // version) discards checkpoints produced under the old wording.
      promptVersion: PROMPT_VERSION
    })
  };
}

export function checkpointSignaturesEqual(a: CheckpointSignature, b: CheckpointSignature): boolean {
  return (
    a.targetLanguage === b.targetLanguage &&
    a.provider === b.provider &&
    a.model === b.model &&
    a.glossaryHash === b.glossaryHash &&
    a.gameId === b.gameId &&
    a.inputsHash === b.inputsHash
  );
}

export function checkpointMetaPath(checkpointPath: string): string {
  return `${checkpointPath}.meta.json`;
}

export type CheckpointSignatureRead =
  | { status: "absent" }
  | { status: "invalid" }
  | { status: "ok"; signature: CheckpointSignature };

// Reads a checkpoint signature, distinguishing three cases so the caller can tell
// "no information" from "bad information". An absent file (a checkpoint from an
// older build or one hand-authored in tests) is resumed for backward
// compatibility; a file that is present but unparseable or missing fields (a
// tampered or half-written meta) is treated as stale so a checkpoint of unknown
// provenance is not resumed and made to ship potentially mismatched output.
export async function readCheckpointSignatureFile(metaPath: string): Promise<CheckpointSignatureRead> {
  let raw: string;
  try {
    raw = await readFile(metaPath, "utf8");
  } catch {
    return { status: "absent" };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<CheckpointSignature>;
    if (
      typeof parsed.targetLanguage === "string" &&
      typeof parsed.provider === "string" &&
      typeof parsed.model === "string" &&
      typeof parsed.glossaryHash === "string"
    ) {
      // gameId and inputsHash were added after the first signature format; a meta
      // written before them stays valid and reads as empty so an upgraded work dir
      // is handled by the normal equality check (an absent inputsHash differs from
      // any computed one, so such a checkpoint is discarded once) rather than
      // failing to parse.
      return {
        status: "ok",
        signature: {
          ...(parsed as CheckpointSignature),
          gameId: typeof parsed.gameId === "string" ? parsed.gameId : "",
          inputsHash: typeof parsed.inputsHash === "string" ? parsed.inputsHash : ""
        }
      };
    }
  } catch {
    return { status: "invalid" };
  }
  return { status: "invalid" };
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
    const previous = await readCheckpointSignatureFile(checkpointMetaPath(checkpointOption));
    // Discard a checkpoint whose signature mismatches, or is present but
    // unparseable/incomplete; only a truly absent signature is resumed.
    stale =
      previous.status === "invalid" ||
      (previous.status === "ok" && !checkpointSignaturesEqual(previous.signature, signature));
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
