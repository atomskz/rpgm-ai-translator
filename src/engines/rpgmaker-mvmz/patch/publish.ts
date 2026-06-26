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

import { copyFile, mkdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import type { ApplyOptions, ApplyResult } from "../../../core/types/public-api.js";
import { isNonEmptyDirectory, pathExists } from "../../../core/utils/fs.js";
import {
  atomicReplaceFile,
  createSiblingTempDir,
  publishDirectory,
  removeIfExists,
  timestamp,
  writeBackupFile,
  writePreparedFile
} from "./fs-ops.js";
import { assertParentInsideOutDir, assertResolvesInsideProject } from "./paths.js";
import type { PreparedFile, PreparedFileSet } from "./prepare.js";

type PatchWriteRecord = {
  relativeFilePath: string;
  existed: boolean;
};

// Patch mode: stage every file, then publish with per-file backup so a failure
// mid-publish rolls every already-replaced file back to what was there before.
export async function writePatchFiles(prepared: PreparedFileSet, outDir: string, skipped: number): Promise<ApplyResult> {
  const stagingDir = await createSiblingTempDir(outDir, "staging");
  const rollbackDir = await createSiblingTempDir(outDir, "rollback");
  const filesWritten: string[] = [];
  let unitsApplied = 0;

  try {
    for (const file of prepared.files) {
      await writePreparedFile(path.join(stagingDir, file.relativeFilePath), file);
      filesWritten.push(path.join(outDir, file.relativeFilePath));
      unitsApplied += file.unitsApplied;
    }

    await publishPatchFiles(stagingDir, rollbackDir, outDir, prepared.files);
  } finally {
    await removeIfExists(stagingDir);
    await removeIfExists(rollbackDir);
  }

  return {
    mode: "patch",
    filesWritten,
    unitsApplied,
    skipped,
    skippedUnmatched: prepared.skippedUnmatched
  };
}

async function publishPatchFiles(
  stagingDir: string,
  rollbackDir: string,
  outDir: string,
  files: PreparedFile[]
): Promise<void> {
  const published: PatchWriteRecord[] = [];
  const realOutDir = await realpath(outDir).catch(() => path.resolve(outDir));

  try {
    for (const file of files) {
      const relativeFilePath = file.relativeFilePath;
      const sourcePath = path.join(stagingDir, relativeFilePath);
      const targetPath = path.join(outDir, relativeFilePath);
      const rollbackPath = path.join(rollbackDir, relativeFilePath);

      // Create the parent, then re-check it still resolves inside the output dir
      // before reading or writing the target, so a directory symlink planted under
      // outDir cannot redirect the write (or the rollback copy) outside it.
      await mkdir(path.dirname(targetPath), { recursive: true });
      await assertParentInsideOutDir(realOutDir, targetPath);

      const existed = await pathExists(targetPath);
      if (existed) {
        await mkdir(path.dirname(rollbackPath), { recursive: true });
        await copyFile(targetPath, rollbackPath);
      }

      await atomicReplaceFile(sourcePath, targetPath);
      published.push({ relativeFilePath, existed });
    }
  } catch (error: unknown) {
    await rollbackPatchFiles(rollbackDir, outDir, published);
    throw error;
  }
}

async function rollbackPatchFiles(rollbackDir: string, outDir: string, published: PatchWriteRecord[]): Promise<void> {
  for (const record of published.reverse()) {
    const targetPath = path.join(outDir, record.relativeFilePath);
    if (record.existed) {
      await atomicReplaceFile(path.join(rollbackDir, record.relativeFilePath), targetPath);
    } else {
      await rm(targetPath, { force: true });
    }
  }
}

// In-place mode: back up the originals, publish the backup, then replace each file,
// rolling back from the backup if any replacement fails.
export async function writeInPlaceFiles(
  root: string,
  prepared: PreparedFileSet,
  options: ApplyOptions
): Promise<ApplyResult> {
  const backupDir = path.resolve(options.backupDir ?? path.join(root, `.rpgm-ai-translator-backup-${timestamp()}`));
  // An explicit --backup is published with a whole-directory rename-swap, which
  // replaces whatever was there. Refuse a non-empty explicit backup dir so the swap
  // cannot silently discard its existing contents; the default timestamped backup is
  // always fresh and so never trips this.
  if (options.backupDir != null && (await isNonEmptyDirectory(backupDir))) {
    throw new Error(
      `Backup directory '${options.backupDir}' is not empty. In-place mode replaces the backup directory with a rename-swap, which would discard its contents; choose an empty or new directory.`
    );
  }
  const realRoot = await realpath(root).catch(() => root);
  const stagingDir = await createSiblingTempDir(root, "staging");
  const backupStagingDir = await createSiblingTempDir(backupDir, "backup");
  const filesWritten: string[] = [];
  let unitsApplied = 0;

  try {
    for (const file of prepared.files) {
      await writePreparedFile(path.join(stagingDir, file.relativeFilePath), file);
      await writeBackupFile(path.join(backupStagingDir, file.relativeFilePath), file);
    }

    await publishDirectory(backupStagingDir, backupDir);

    const replaced: PreparedFile[] = [];
    try {
      for (const file of prepared.files) {
        await assertResolvesInsideProject(realRoot, file.sourcePath);
        await atomicReplaceFile(path.join(stagingDir, file.relativeFilePath), file.sourcePath);
        replaced.push(file);
        filesWritten.push(file.sourcePath);
        unitsApplied += file.unitsApplied;
      }
    } catch (error: unknown) {
      await restoreInPlaceFiles(backupDir, replaced);
      throw error;
    }
  } finally {
    await removeIfExists(stagingDir);
    await removeIfExists(backupStagingDir);
  }

  return {
    mode: "in-place",
    filesWritten,
    unitsApplied,
    skipped: prepared.skipped,
    skippedUnmatched: prepared.skippedUnmatched,
    backupDir
  };
}

async function restoreInPlaceFiles(backupDir: string, replaced: PreparedFile[]): Promise<void> {
  for (const file of replaced.reverse()) {
    await atomicReplaceFile(path.join(backupDir, file.relativeFilePath), file.sourcePath);
  }
}
