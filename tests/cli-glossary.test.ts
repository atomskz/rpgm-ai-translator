import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli/app.js";
import type { TranslationUnit } from "../src/core/types/public-api.js";

function unit(id: string, source: string): TranslationUnit {
  return {
    id,
    source,
    filePath: "data/Map001.json",
    jsonPath: id,
    engine: "rpgmaker-mz",
    category: "dialogue",
    hash: id
  };
}

async function writeJsonFile(dir: string, name: string, value: unknown): Promise<string> {
  const file = path.join(dir, name);
  await writeFile(file, JSON.stringify(value), "utf8");
  return file;
}

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, io: { stdout: (t: string) => stdout.push(t), stderr: (t: string) => stderr.push(t) } };
}

describe("glossary extract", () => {
  it("drafts frequently recurring proper nouns and excludes common words", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rpgm-glossary-extract-"));
    const unitsPath = await writeJsonFile(dir, "units.json", [
      unit("1", "Aria walked to the gate."),
      unit("2", "Then Aria smiled at Bell."),
      unit("3", "Aria and Bell left.")
    ]);
    const out = path.join(dir, "glossary.json");
    const { stderr, io } = capture();

    const code = await runCli(["glossary", "extract", unitsPath, "--out", out], io);

    expect(code).toBe(0);
    const glossary = JSON.parse(await readFile(out, "utf8"));
    // Aria (3x) and Bell (2x) recur and never appear lowercased.
    expect(glossary).toMatchObject({ Aria: { mode: "keep" }, Bell: { mode: "keep" } });
    // "Then" occurs once (below the default min of 2); no lowercase word is drafted.
    expect(glossary).not.toHaveProperty("Then");
    expect(glossary).not.toHaveProperty("the");
    expect(stderr.join("")).toContain("Drafted 2 glossary terms");
  });

  it("respects --min-occurrences", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rpgm-glossary-min-"));
    const unitsPath = await writeJsonFile(dir, "units.json", [
      unit("1", "Aria met Bell."),
      unit("2", "Aria smiled."),
      unit("3", "Aria nodded.")
    ]);
    const out = path.join(dir, "glossary.json");
    const { io } = capture();

    await runCli(["glossary", "extract", unitsPath, "--out", out, "--min-occurrences", "3"], io);

    const glossary = JSON.parse(await readFile(out, "utf8"));
    // Aria appears 3x (kept); Bell appears once (below 3).
    expect(glossary).toHaveProperty("Aria");
    expect(glossary).not.toHaveProperty("Bell");
  });
});

describe("glossary check", () => {
  it("accepts a valid glossary", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rpgm-glossary-check-ok-"));
    const file = await writeJsonFile(dir, "glossary.json", { Aria: { mode: "keep" }, Bell: { mode: "custom", translation: "Белл" } });
    const { stderr, io } = capture();

    const code = await runCli(["glossary", "check", file], io);

    expect(code).toBe(0);
    expect(stderr.join("")).toContain("is valid: 2 terms");
  });

  it("rejects a structurally invalid glossary", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rpgm-glossary-check-bad-"));
    const file = await writeJsonFile(dir, "glossary.json", { Aria: { mode: "bogus" } });
    const { stderr, io } = capture();

    const code = await runCli(["glossary", "check", file], io);

    expect(code).toBe(1);
    expect(stderr.join("")).toContain("Invalid glossary");
  });

  it("rejects terms that differ only by case", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rpgm-glossary-check-dup-"));
    const file = await writeJsonFile(dir, "glossary.json", { Aria: { mode: "keep" }, aria: { mode: "keep" } });
    const { stderr, io } = capture();

    const code = await runCli(["glossary", "check", file], io);

    expect(code).toBe(1);
    expect(stderr.join("")).toContain("differing only by case");
  });
});
