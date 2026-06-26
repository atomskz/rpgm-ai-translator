import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli/app.js";
import { createCliTempDir, writeJsonFixture } from "./cli/helpers.js";

function result(id: string, translation: string) {
  return { id, source: id, translation, provider: "mock", model: "mock", status: "translated" };
}

describe("CLI diff", () => {
  it("shows per-unit changes across raw, reviewed and repaired", async () => {
    const root = await createCliTempDir("rpgm-cli-diff-");
    const rawPath = path.join(root, "raw.json");
    const reviewedPath = path.join(root, "reviewed.json");
    const repairedPath = path.join(root, "repaired.json");
    await writeJsonFixture(rawPath, [result("a", "Привет"), result("b", "Стоп")]);
    // "a" changes in review; "b" is unchanged in review but changes in repair.
    await writeJsonFixture(reviewedPath, [result("a", "Привет, друг"), result("b", "Стоп")]);
    await writeJsonFixture(repairedPath, [result("a", "Привет, друг"), result("b", "Стой")]);

    const stdout: string[] = [];
    const exitCode = await runCli(["diff", rawPath, reviewedPath, repairedPath], {
      stdout: (text) => stdout.push(text),
      stderr: () => undefined
    });

    const md = stdout.join("");
    expect(exitCode).toBe(0);
    expect(md).toContain("2 of 2 unit(s) changed");
    expect(md).toContain("## a");
    expect(md).toContain("- reviewed: Привет, друг");
    expect(md).toContain("## b");
    expect(md).toContain("- repaired: Стой");
  });

  it("writes to --out and reports nothing changed when files are identical", async () => {
    const root = await createCliTempDir("rpgm-cli-diff-same-");
    const rawPath = path.join(root, "raw.json");
    const reviewedPath = path.join(root, "reviewed.json");
    const outPath = path.join(root, "diff.md");
    await writeJsonFixture(rawPath, [result("a", "Привет")]);
    await writeJsonFixture(reviewedPath, [result("a", "Привет")]);

    const exitCode = await runCli(["diff", rawPath, reviewedPath, "--out", outPath], {
      stdout: () => undefined,
      stderr: () => undefined
    });

    const md = await readFile(outPath, "utf8");
    expect(exitCode).toBe(0);
    expect(md).toContain("No translations changed");
  });
});
