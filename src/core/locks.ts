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

import { rmSync } from "node:fs";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

export const LOCK_FILENAME = ".rpgm-run.lock";

// Per-process counter so each reclaim renames the stale lock to a unique name,
// even when the same process reclaims more than once.
let reclaimCounter = 0;

export type DirectoryLock = {
  release(): Promise<void>;
  // Synchronous removal for signal handlers, which must finish before the process
  // is torn down (an async release would not run in time).
  releaseSync(): void;
};

// Acquire an exclusive lock at an explicit lock-file path. The lock is a single
// file created with O_EXCL; if it already exists and its recorded pid is still
// alive, acquisition fails fast. `busyMessage` customizes the failure text so a
// directory lock and a memory-file lock can each explain their own remedy.
export async function acquireLockFile(lockPath: string, busyMessage?: string): Promise<DirectoryLock> {
  await mkdir(path.dirname(lockPath), { recursive: true });
  await createLockFile(lockPath, busyMessage);
  let released = false;
  return {
    async release() {
      if (released) {
        return;
      }
      released = true;
      await rm(lockPath, { force: true });
    },
    releaseSync() {
      if (released) {
        return;
      }
      released = true;
      rmSync(lockPath, { force: true });
    }
  };
}

// Acquire an exclusive lock on a directory for the duration of a run, so two
// runs sharing the same work dir cannot interleave checkpoint/memory appends and
// corrupt them.
export async function acquireDirectoryLock(dirPath: string): Promise<DirectoryLock> {
  return acquireLockFile(path.join(dirPath, LOCK_FILENAME));
}

// Run `fn` while holding an exclusive lock at `lockPath`, releasing it afterwards —
// and synchronously on SIGINT/SIGTERM. Used to serialize translation-memory writes
// keyed on the memory file, so two processes sharing a --memory file cannot lose
// each other's entries when one compacts the log.
export async function withLockFile<T>(lockPath: string, busyMessage: string, fn: () => Promise<T>): Promise<T> {
  const lock = await acquireLockFile(lockPath, busyMessage);
  const onSignal = (signal: NodeJS.Signals): void => {
    lock.releaseSync();
    process.kill(process.pid, signal);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    return await fn();
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    await lock.release();
  }
}

// Run `fn` while holding an exclusive lock on `dirPath`, releasing it afterwards —
// and synchronously on SIGINT/SIGTERM so a Ctrl-C during the critical section does
// not leave a lock owned by a dead pid. Used to serialize patch writes into an
// output (or in-place game) directory so two concurrent apply/run invocations
// cannot interleave their staged-write/rollback steps.
export async function withDirectoryLock<T>(dirPath: string, fn: () => Promise<T>): Promise<T> {
  const lock = await acquireDirectoryLock(dirPath);
  const onSignal = (signal: NodeJS.Signals): void => {
    lock.releaseSync();
    process.kill(process.pid, signal);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    return await fn();
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    await lock.release();
  }
}

async function createLockFile(lockPath: string, busyMessage?: string): Promise<void> {
  // A starting run may find a stale lock and reclaim it, and another starting run
  // can race for the same one. reclaimStaleLock elects a single winner, so loop a
  // bounded number of times: create, and on EEXIST either reclaim (if stale) or
  // give up to a live holder.
  for (let attempt = 0; attempt < 3; attempt += 1) {
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
    if (!(await isStaleLock(lockPath))) {
      break;
    }
    await reclaimStaleLock(lockPath);
  }
  throw new Error(
    busyMessage ??
      `Another run is using '${path.dirname(lockPath)}' (lock file '${lockPath}'). ` +
        "Wait for it to finish, pass a different --work-dir, or delete the lock file if no run is active."
  );
}

// Claim the right to delete a stale lock atomically by renaming it to a unique
// name first. The source exists once, so only one concurrent reclaimer's rename
// succeeds; the rest get ENOENT and retry. Without this, two runs could both rm
// the stale lock and recreate it, ending up as co-owners of the same work dir.
async function reclaimStaleLock(lockPath: string): Promise<void> {
  const reclaimedPath = `${lockPath}.${process.pid}.${reclaimCounter++}.stale`;
  try {
    await rename(lockPath, reclaimedPath);
  } catch (error: unknown) {
    if (isErrno(error, "ENOENT")) {
      // Another reclaimer moved it first; loop and try to create our own lock.
      return;
    }
    throw error;
  }
  await rm(reclaimedPath, { force: true });
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
