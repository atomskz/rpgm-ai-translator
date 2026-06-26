import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { writeBackupFile } from "../src/engines/rpgmaker-mvmz/patch/fs-ops.js";
import { writeInPlaceFiles } from "../src/engines/rpgmaker-mvmz/patch/publish.js";
import type { PreparedFile, PreparedFileSet } from "../src/engines/rpgmaker-mvmz/patch/prepare.js";

describe("writeBackupFile", () => {
  it("backs up a non-UTF-8 original byte-for-byte", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-backup-bytes-"));
    const source = path.join(root, "plugins.js");
    // Bytes that are not valid UTF-8 (a Shift-JIS あ is 0x82 0xA0, plus a lone
    // 0xFF). A readFile/writeFile "utf8" round-trip would replace these with the
    // U+FFFD replacement character and corrupt the backup; a byte copy must not.
    const bytes = Buffer.from([0x82, 0xa0, 0xff, 0x00, 0x41]);
    await writeFile(source, bytes);

    const backup = path.join(root, "backup", "plugins.js");
    const file: PreparedFile = {
      relativeFilePath: "plugins.js",
      sourcePath: source,
      content: "",
      format: "text",
      unitsApplied: 0,
      skipped: 0
    };
    await writeBackupFile(backup, file);

    const backedUp = await readFile(backup);
    expect(backedUp.equals(bytes)).toBe(true);
  });
});

describe("in-place backup directory guard", () => {
  function jsonFile(relativeFilePath: string, sourcePath: string, content: unknown): PreparedFile {
    return { relativeFilePath, sourcePath, content, format: "json", unitsApplied: 1, skipped: 0 };
  }
  function fileSet(files: PreparedFile[]): PreparedFileSet {
    return { files, skipped: 0, skippedUnmatched: 0 };
  }

  it("refuses an explicit --backup directory that is not empty", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-backup-nonempty-"));
    await mkdir(path.join(root, "data"), { recursive: true });
    await writeFile(path.join(root, "data", "A.json"), JSON.stringify({ v: "orig" }), "utf8");
    // A populated explicit backup dir: the rename-swap would discard its contents.
    const backupDir = path.join(await mkdtemp(path.join(tmpdir(), "rpgm-backup-dst-")), "backup");
    await mkdir(backupDir, { recursive: true });
    await writeFile(path.join(backupDir, "important.txt"), "do not lose me", "utf8");

    const prepared = fileSet([jsonFile("data/A.json", path.join(root, "data", "A.json"), { v: "new" })]);

    await expect(writeInPlaceFiles(root, prepared, { mode: "in-place", backupDir })).rejects.toThrow(/not empty/);
    // The original game file is untouched and the backup contents survive.
    expect(JSON.parse(await readFile(path.join(root, "data", "A.json"), "utf8"))).toEqual({ v: "orig" });
    expect(await readFile(path.join(backupDir, "important.txt"), "utf8")).toBe("do not lose me");
  });

  it("allows an empty explicit --backup directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-backup-empty-"));
    await mkdir(path.join(root, "data"), { recursive: true });
    await writeFile(path.join(root, "data", "A.json"), JSON.stringify({ v: "orig" }), "utf8");
    const backupDir = path.join(await mkdtemp(path.join(tmpdir(), "rpgm-backup-dst-")), "backup");

    const prepared = fileSet([jsonFile("data/A.json", path.join(root, "data", "A.json"), { v: "new" })]);

    const result = await writeInPlaceFiles(root, prepared, { mode: "in-place", backupDir });
    expect(result.unitsApplied).toBe(1);
    // The original was backed up before being replaced.
    expect(JSON.parse(await readFile(path.join(backupDir, "data", "A.json"), "utf8"))).toEqual({ v: "orig" });
  });
});
