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

import path from "node:path";
import { loadCharacterGlossary, loadGlossary } from "../../config/public-api.js";
import { detectEngine } from "../../engines/registry.js";
import { readTranslationResultsJsonlFile, readTranslationUnitsFile } from "../../core/translation-units.js";
import {
  checkpointSignature,
  checkpointSignaturesEqual,
  computeExtractionFlagsHash,
  computeGameId,
  readCheckpointSignatureFile,
  type CheckpointSignature
} from "../checkpoints.js";
import {
  readExtractOptions,
  readOption,
  readProviderCliOptions,
  readProviderName,
  requireOption,
  requirePositional
} from "../options/public-api.js";
import type { CliIO } from "../types.js";

// Inspect a run's resumability without touching anything: report how many units
// translated/reviewed/repaired, the stored run signature, and — given the game and
// the flags you would re-run with — whether the next run would resume or reset.
export async function statusCommand(args: string[], io: CliIO): Promise<number> {
  const projectPath = requirePositional(args, 0, "project path");
  const outDir = requireOption(args, "--out");
  const workDir = readOption(args, "--work-dir") ?? `${outDir}-work`;

  const total = await countUnits(path.join(workDir, "units.json"));
  const translated = await countDistinctTranslated(path.join(workDir, "translations.raw.jsonl"));
  const reviewed = await countDistinctTranslated(path.join(workDir, "translations.reviewed.jsonl"));
  const repaired = await countDistinctTranslated(path.join(workDir, "translations.repaired.jsonl"));

  const stored = await readCheckpointSignatureFile(path.join(workDir, "checkpoint.meta.json"));
  const current = await computeCurrentSignature(projectPath, args);

  let verdict: string;
  let changedFields: string[] = [];
  if (stored.status === "absent") {
    verdict = "no stored signature (an older or fresh work dir): the next run would start fresh and stamp one";
  } else if (stored.status === "invalid") {
    verdict = "stored signature is unparseable: the next run would discard these checkpoints and start fresh";
  } else if (checkpointSignaturesEqual(stored.signature, current)) {
    verdict = "the next run with these flags would RESUME from the checkpoints";
  } else {
    changedFields = differingFields(stored.signature, current);
    verdict = `the next run with these flags would RESET (changed: ${changedFields.join(", ")})`;
  }

  const report = {
    workDir,
    units: { total, translated, reviewed, repaired },
    storedSignature: stored.status === "ok" ? stored.signature : null,
    currentSignature: current,
    resume: verdict,
    changedFields
  };
  io.stdout(`${JSON.stringify(report, null, 2)}\n`);
  io.stderr(
    `Work dir '${workDir}': ${translated}${total != null ? `/${total}` : ""} translated, ${reviewed} reviewed, ${repaired} repaired. ${verdict}.\n`
  );
  return 0;
}

async function computeCurrentSignature(projectPath: string, args: string[]): Promise<CheckpointSignature> {
  const { detected } = await detectEngine(projectPath);
  const providerName = readProviderName(args);
  const providerOptions = readProviderCliOptions(args);
  const glossaryPath = readOption(args, "--glossary");
  const charactersPath = readOption(args, "--characters");
  const glossary = glossaryPath ? await loadGlossary(glossaryPath) : undefined;
  const characterGlossary = charactersPath ? await loadCharacterGlossary(charactersPath) : undefined;
  return checkpointSignature(providerName, providerOptions, glossary, characterGlossary, {
    gameId: computeGameId(projectPath, detected.engine),
    extractionFlagsHash: computeExtractionFlagsHash(readExtractOptions(args))
  });
}

function differingFields(a: CheckpointSignature, b: CheckpointSignature): string[] {
  const fields: Array<keyof CheckpointSignature> = [
    "targetLanguage",
    "provider",
    "model",
    "glossaryHash",
    "gameId",
    "inputsHash"
  ];
  const labels: Record<string, string> = {
    glossaryHash: "glossary/characters",
    gameId: "game",
    inputsHash: "sampling/extraction flags"
  };
  return fields.filter((field) => a[field] !== b[field]).map((field) => labels[field] ?? field);
}

async function countUnits(unitsPath: string): Promise<number | undefined> {
  try {
    return (await readTranslationUnitsFile(unitsPath)).length;
  } catch {
    return undefined;
  }
}

async function countDistinctTranslated(jsonlPath: string): Promise<number> {
  const results = await readTranslationResultsJsonlFile(jsonlPath);
  const ids = new Set<string>();
  for (const result of results) {
    if (result.status === "translated") {
      ids.add(result.id);
    }
  }
  return ids.size;
}
