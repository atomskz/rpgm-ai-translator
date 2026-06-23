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

import { mkdir, open, readFile, rm } from "node:fs/promises";
import path from "node:path";

const LOCK_FILENAME = ".rpgm-run.lock";

export type DirectoryLock = {
  release(): Promise<void>;
};

// Acquire an exclusive lock on a directory for the duration of a run, so two
// runs sharing the same work dir cannot interleave checkpoint/memory appends and
// corrupt them. The lock is a single file created with O_EXCL; if it already
// exists and its recorded pid is still alive, acquisition fails fast.
export async function acquireDirectoryLock(dirPath: string): Promise<DirectoryLock> {
  await mkdir(dirPath, { recursive: true });
  const lockPath = path.join(dirPath, LOCK_FILENAME);
  await createLockFile(lockPath);
  let released = false;
  return {
    async release() {
      if (released) {
        return;
      }
      released = true;
      await rm(lockPath, { force: true });
    }
  };
}

async function createLockFile(lockPath: string): Promise<void> {
  try {
    await writeNewLockFile(lockPath);
    return;
  } catch (error: unknown) {
    if (!isErrno(error, "EEXIST")) {
      throw error;
    }
  }
  // The lock exists. Reclaim it only if the run that wrote it has clearly died;
  // otherwise refuse so a live concurrent run is never disturbed.
  if (await isStaleLock(lockPath)) {
    await rm(lockPath, { force: true });
    try {
      await writeNewLockFile(lockPath);
      return;
    } catch (error: unknown) {
      if (!isErrno(error, "EEXIST")) {
        throw error;
      }
    }
  }
  throw new Error(
    `Another run is using '${path.dirname(lockPath)}' (lock file '${lockPath}'). ` +
      "Wait for it to finish, pass a different --work-dir, or delete the lock file if no run is active."
  );
}

async function writeNewLockFile(lockPath: string): Promise<void> {
  // "wx" = O_CREAT | O_EXCL | O_WRONLY: fails with EEXIST if the file is present,
  // which is the atomic test-and-set the lock relies on.
  const handle = await open(lockPath, "wx");
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), "utf8");
  } finally {
    await handle.close();
  }
}

async function isStaleLock(lockPath: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(lockPath, "utf8");
  } catch {
    return false;
  }
  let pid: unknown;
  try {
    pid = (JSON.parse(raw) as { pid?: unknown }).pid;
  } catch {
    return false;
  }
  if (typeof pid !== "number" || !Number.isInteger(pid)) {
    return false;
  }
  try {
    // Signal 0 only probes for the process; it does not actually signal it.
    process.kill(pid, 0);
    return false;
  } catch (error: unknown) {
    // ESRCH: no such process -> stale. EPERM: alive but not ours -> still live.
    return isErrno(error, "ESRCH");
  }
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}
