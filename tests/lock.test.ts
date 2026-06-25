import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { acquireDirectoryLock } from "../src/core/locks.js";

const LOCK_FILENAME = ".rpgm-run.lock";

describe("acquireDirectoryLock", () => {
  it("rejects a second acquisition while the lock is held", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rpgm-lock-"));
    const lock = await acquireDirectoryLock(dir);

    await expect(acquireDirectoryLock(dir)).rejects.toThrow("Another run is using");

    await lock.release();
  });

  it("allows re-acquisition after release and removes the lock file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rpgm-lock-"));
    const first = await acquireDirectoryLock(dir);
    await first.release();

    expect(await readdir(dir)).not.toContain(LOCK_FILENAME);

    const second = await acquireDirectoryLock(dir);
    await second.release();
  });

  it("reclaims a stale lock whose recorded pid is no longer alive", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rpgm-lock-"));
    // A pid past the kernel maximum cannot belong to a live process.
    await writeFile(path.join(dir, LOCK_FILENAME), JSON.stringify({ pid: 2147483646, startedAt: "x" }), "utf8");

    const lock = await acquireDirectoryLock(dir);
    await lock.release();
  });

  it("treats a lock held by a live pid as busy", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rpgm-lock-"));
    // Our own pid is alive, so the lock must be considered held.
    await writeFile(path.join(dir, LOCK_FILENAME), JSON.stringify({ pid: process.pid, startedAt: "x" }), "utf8");

    await expect(acquireDirectoryLock(dir)).rejects.toThrow("Another run is using");
  });

  it("releasing twice is a no-op", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rpgm-lock-"));
    const lock = await acquireDirectoryLock(dir);
    await lock.release();
    await expect(lock.release()).resolves.toBeUndefined();
  });

  it("releaseSync removes the lock file so a later run can acquire it", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rpgm-lock-"));
    const lock = await acquireDirectoryLock(dir);

    lock.releaseSync();
    expect(await readdir(dir)).not.toContain(LOCK_FILENAME);

    const second = await acquireDirectoryLock(dir);
    await second.release();
  });

  it("never grants two owners when concurrent runs reclaim the same stale lock", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rpgm-lock-"));
    // A dead pid makes the existing lock reclaimable, so both racers contend for it.
    await writeFile(path.join(dir, LOCK_FILENAME), JSON.stringify({ pid: 2147483646, startedAt: "x" }), "utf8");

    const results = await Promise.allSettled([acquireDirectoryLock(dir), acquireDirectoryLock(dir)]);
    const acquired = results.filter((result) => result.status === "fulfilled");

    expect(acquired).toHaveLength(1);
    for (const result of results) {
      if (result.status === "fulfilled") {
        await result.value.release();
      }
    }
  });
});
