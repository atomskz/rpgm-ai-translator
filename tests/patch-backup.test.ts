import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { writeBackupFile } from "../src/engines/rpgmaker-mvmz/patch/fs-ops.js";
import type { PreparedFile } from "../src/engines/rpgmaker-mvmz/patch/prepare.js";

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
