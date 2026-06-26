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

import { rm } from "node:fs/promises";
import path from "node:path";
import { LOCK_FILENAME } from "../../core/locks.js";
import { pathExists } from "../../core/utils/fs.js";
import { hasFlag, readOption, UsageError } from "../options/public-api.js";
import type { CliIO } from "../types.js";

const MEMORY_FILENAME = "translation-memory.jsonl";

const CHECKPOINT_FILES = [
  "translations.raw.jsonl",
  "translations.reviewed.jsonl",
  "translations.repaired.jsonl",
  "checkpoint.meta.json",
  "repair-progress.json"
];

// Safely clean a run's internal work-dir artifacts (checkpoints, the lock, and
// optionally the translation memory) so a translator can recover from a crashed or
// abandoned run without hand-`rm`-ing internal files. It only ever touches files
// inside the work directory, never the game or the patch output.
export async function cleanCommand(args: string[], io: CliIO): Promise<number> {
  const workDir = resolveWorkDir(args);
  const dryRun = hasFlag(args, "--dry-run");

  // Default (no category flag): checkpoints + lock, preserving memory; --all adds
  // memory; an explicit set of flags selects exactly those categories. The memory
  // flag is --with-memory (not --memory, which is a value option elsewhere).
  const all = hasFlag(args, "--all");
  const explicit = hasFlag(args, "--checkpoints") || hasFlag(args, "--with-memory") || hasFlag(args, "--lock");
  const doCheckpoints = all || !explicit || hasFlag(args, "--checkpoints");
  const doLock = all || !explicit || hasFlag(args, "--lock");
  const doMemory = all || hasFlag(args, "--with-memory");

  const targets = new Set<string>();
  if (doCheckpoints) {
    CHECKPOINT_FILES.forEach((name) => targets.add(path.join(workDir, name)));
  }
  if (doLock) {
    targets.add(path.join(workDir, LOCK_FILENAME));
    targets.add(path.join(workDir, `${MEMORY_FILENAME}.lock`));
  }
  if (doMemory) {
    targets.add(path.join(workDir, MEMORY_FILENAME));
    targets.add(path.join(workDir, `${MEMORY_FILENAME}.lock`));
  }

  const removed: string[] = [];
  for (const target of [...targets].sort()) {
    if (!(await pathExists(target))) {
      continue;
    }
    if (!dryRun) {
      await rm(target, { force: true });
    }
    removed.push(target);
  }

  for (const target of removed) {
    io.stdout(`${dryRun ? "would remove" : "removed"}: ${target}\n`);
  }
  io.stderr(
    `${dryRun ? "[dry run] " : ""}${dryRun ? "Would clean" : "Cleaned"} ${removed.length} file(s) from '${workDir}'` +
      `${doMemory ? "" : " (translation memory preserved)"}.\n`
  );
  return 0;
}

function resolveWorkDir(args: string[]): string {
  const workDir = readOption(args, "--work-dir");
  if (workDir) {
    return workDir;
  }
  const out = readOption(args, "--out");
  if (out) {
    return `${out}-work`;
  }
  throw new UsageError("clean needs --work-dir <dir> or --out <dir> (to derive <out>-work).");
}
