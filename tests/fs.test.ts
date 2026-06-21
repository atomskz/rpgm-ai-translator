import { mkdir, mkdtemp, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { writeFileAtomic } from "../src/core/utils/fs.js";

describe("writeFileAtomic", () => {
  it("creates parent directories and writes the content", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-atomic-"));
    const filePath = path.join(root, "nested", "out.json");

    await writeFileAtomic(filePath, "hello\n");

    expect(await readFile(filePath, "utf8")).toBe("hello\n");
    expect(await readdir(path.dirname(filePath))).toEqual(["out.json"]);
  });

  it("overwrites existing content without leaving temp files behind", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-atomic-"));
    const filePath = path.join(root, "out.json");

    await writeFileAtomic(filePath, "first");
    await writeFileAtomic(filePath, "second");

    expect(await readFile(filePath, "utf8")).toBe("second");
    expect(await readdir(root)).toEqual(["out.json"]);
  });

  it("cleans up the temp file and rethrows when the write cannot be published", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-atomic-"));
    const filePath = path.join(root, "target");
    // Make the destination an existing directory so the final rename fails.
    await mkdir(filePath);

    await expect(writeFileAtomic(filePath, "x")).rejects.toThrow();
    // No leftover `.tmp-*` staging file: the failure path removed it.
    expect(await readdir(root)).toEqual(["target"]);
  });
});
