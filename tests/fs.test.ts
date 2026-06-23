import { mkdir, mkdtemp, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { detectEol, detectJsonStyle, serializeJson, writeFileAtomic } from "../src/core/utils/fs.js";

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

describe("detectEol", () => {
  it("returns CRLF only when CRLF strictly outnumbers bare LF", () => {
    expect(detectEol('{\r\n  "a": 1\r\n}')).toBe("\r\n");
    expect(detectEol('{\n  "a": 1\n}')).toBe("\n");
    // A single stray CRLF in an otherwise-LF file stays LF.
    expect(detectEol('{\r\n  "a": 1,\n  "b": 2\n}')).toBe("\n");
    expect(detectEol("{}")).toBe("\n");
  });
});

describe("detectJsonStyle / serializeJson round-trip", () => {
  it("preserves CRLF line endings on a pretty file", () => {
    const raw = '{\r\n  "a": 1,\r\n  "b": 2\r\n}\r\n';
    const style = detectJsonStyle(raw);
    expect(style.eol).toBe("\r\n");
    expect(serializeJson(JSON.parse(raw), style)).toBe(raw);
  });

  it("keeps LF files on LF and does not introduce CR", () => {
    const raw = '{\n  "a": 1\n}\n';
    const style = detectJsonStyle(raw);
    expect(style.eol).toBe("\n");
    const out = serializeJson(JSON.parse(raw), style);
    expect(out).toBe(raw);
    expect(out).not.toContain("\r");
  });

  it("escapes newlines inside string values rather than converting them to CRLF", () => {
    const style = detectJsonStyle('{\r\n  "a": 1\r\n}\r\n');
    const out = serializeJson({ a: "line1\nline2" }, style);
    // The literal newline in the value is escaped (\n), only structural breaks are CRLF.
    expect(out).toContain("line1\\nline2");
    expect(out).not.toContain("line1\r\nline2");
  });
});
