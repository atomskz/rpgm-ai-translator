import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { publishDirectory } from "../src/engines/rpgmaker-mvmz/patch/fs-ops.js";
import { writeInPlaceFiles, writePatchFiles } from "../src/engines/rpgmaker-mvmz/patch/publish.js";
import type { PreparedFile, PreparedFileSet } from "../src/engines/rpgmaker-mvmz/patch/prepare.js";

// These cover the failure-recovery paths of the patch writer: the branches that
// run only after a write has already partially happened, where a wrong rollback
// would leave a player's game corrupted. They are driven with real filesystem
// obstacles (a missing staging dir, a directory where a file is expected, a
// source that resolves outside the project) rather than mocks.

function jsonFile(relativeFilePath: string, sourcePath: string, content: unknown): PreparedFile {
  return { relativeFilePath, sourcePath, content, format: "json", unitsApplied: 1, skipped: 0 };
}

function fileSet(files: PreparedFile[]): PreparedFileSet {
  return { files, skipped: 0, skippedUnmatched: 0 };
}

describe("publishDirectory", () => {
  it("replaces an existing target directory in place", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-pubdir-"));
    const target = path.join(root, "target");
    const staging = path.join(root, "staging");
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, "old.txt"), "old", "utf8");
    await mkdir(staging, { recursive: true });
    await writeFile(path.join(staging, "new.txt"), "new", "utf8");

    await publishDirectory(staging, target);

    expect(await readFile(path.join(target, "new.txt"), "utf8")).toBe("new");
    // The directory was swapped wholesale, so the previous contents are gone.
    await expect(readFile(path.join(target, "old.txt"), "utf8")).rejects.toThrow();
  });

  it("restores the original directory when staging cannot be renamed into place", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-pubdir-fail-"));
    const target = path.join(root, "target");
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, "keep.txt"), "original", "utf8");
    const missingStaging = path.join(root, "does-not-exist");

    await expect(publishDirectory(missingStaging, target)).rejects.toThrow();

    // The target was moved aside then the staging rename failed; the original must
    // be rolled back into place rather than left missing.
    expect(await readFile(path.join(target, "keep.txt"), "utf8")).toBe("original");
  });
});

describe("patch-mode publish rollback", () => {
  it("restores pre-existing files and removes newly-created ones when a later file fails", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "rpgm-patch-rb-"));
    const outDir = path.join(base, "out");
    await mkdir(path.join(outDir, "data"), { recursive: true });
    // A1 already exists in the output: rollback must restore its original bytes.
    await writeFile(path.join(outDir, "data", "A1.json"), JSON.stringify({ v: "orig-A1" }), "utf8");
    // A2 does not exist yet: rollback must delete what the publish created.
    // B's target is a non-empty directory, so publishing it throws after A1 and A2 succeeded.
    await mkdir(path.join(outDir, "data", "B.json"), { recursive: true });
    await writeFile(path.join(outDir, "data", "B.json", "blocker"), "x", "utf8");

    const prepared = fileSet([
      jsonFile("data/A1.json", path.join(base, "src-A1.json"), { v: "new-A1" }),
      jsonFile("data/A2.json", path.join(base, "src-A2.json"), { v: "new-A2" }),
      jsonFile("data/B.json", path.join(base, "src-B.json"), { v: "new-B" })
    ]);

    await expect(writePatchFiles(prepared, outDir, 0)).rejects.toThrow();

    const restored = JSON.parse(await readFile(path.join(outDir, "data", "A1.json"), "utf8"));
    expect(restored).toEqual({ v: "orig-A1" });
    // The file that did not exist before the run must be gone again.
    await expect(readFile(path.join(outDir, "data", "A2.json"), "utf8")).rejects.toThrow();
  });
});

describe("patch-mode symlink guard", () => {
  it("refuses to write through a directory symlink planted under the output dir", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "rpgm-patch-symlink-"));
    const outDir = path.join(base, "out");
    await mkdir(outDir, { recursive: true });
    // Plant a directory symlink: outDir/data -> an unrelated directory outside outDir.
    const outside = await mkdtemp(path.join(tmpdir(), "rpgm-out-escape-"));
    await symlink(outside, path.join(outDir, "data"), "dir");

    const prepared = fileSet([jsonFile("data/Foo.json", path.join(base, "src-Foo.json"), { v: "new" })]);

    await expect(writePatchFiles(prepared, outDir, 0)).rejects.toThrow(/outside the output directory/);
    // The file must not have been written through the symlink into the outside dir.
    await expect(readFile(path.join(outside, "Foo.json"), "utf8")).rejects.toThrow();
  });
});

describe("in-place publish rollback", () => {
  it("restores in-place originals when a replacement resolves outside the project", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-inplace-rb-"));
    await mkdir(path.join(root, "data"), { recursive: true });
    await writeFile(path.join(root, "data", "A.json"), JSON.stringify({ v: "orig-A" }), "utf8");
    // B's source resolves outside the project, so the pre-write guard rejects it
    // after A was already replaced — exercising the in-place restore path.
    const outside = await mkdtemp(path.join(tmpdir(), "rpgm-outside-"));
    const outsideB = path.join(outside, "B.json");
    await writeFile(outsideB, JSON.stringify({ v: "new-B" }), "utf8");
    const backupDir = path.join(await mkdtemp(path.join(tmpdir(), "rpgm-backup-")), "backup");

    const prepared = fileSet([
      jsonFile("data/A.json", path.join(root, "data", "A.json"), { v: "new-A" }),
      jsonFile("B.json", outsideB, { v: "new-B" })
    ]);

    await expect(writeInPlaceFiles(root, prepared, { mode: "in-place", backupDir })).rejects.toThrow();

    const restored = JSON.parse(await readFile(path.join(root, "data", "A.json"), "utf8"));
    expect(restored).toEqual({ v: "orig-A" });
  });
});
