import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli/app.js";
import { actorNameUnit, createCliTempDir, writeJsonFixture } from "./cli/helpers.js";

describe("CLI report summarize", () => {
  async function seed(root: string): Promise<{ reportPath: string; unitsPath: string; translationsPath: string }> {
    const unitsPath = path.join(root, "units.json");
    const translationsPath = path.join(root, "translations.json");
    const reportPath = path.join(root, "report.json");
    await writeJsonFixture(unitsPath, [actorNameUnit({ source: "Aria the Brave Knight of Dawn" })]);
    await writeJsonFixture(translationsPath, [
      { id: "Actors.1.name", source: "Aria the Brave Knight of Dawn", translation: "Ария очень длинное имя", status: "translated" }
    ]);
    await writeJsonFixture(reportPath, {
      schemaVersion: 1,
      engine: "rpgmaker-mv",
      filesScanned: 1,
      unitsExtracted: 1,
      unitsTranslated: 1,
      fromMemory: 0,
      failed: 0,
      validationIssues: [
        { id: "Actors.1.name", severity: "error", code: "MAX_LENGTH_EXCEEDED", message: "Too long (24 > 10 cells)" }
      ]
    });
    return { reportPath, unitsPath, translationsPath };
  }

  it("writes a Markdown review doc joining issue, source and translation", async () => {
    const root = await createCliTempDir("rpgm-cli-report-");
    const { reportPath, unitsPath, translationsPath } = await seed(root);
    const outPath = path.join(root, "review.md");

    const exitCode = await runCli(
      ["report", "summarize", reportPath, "--units", unitsPath, "--translations", translationsPath, "--out", outPath],
      { stdout: () => undefined, stderr: () => undefined }
    );

    const md = await readFile(outPath, "utf8");
    expect(exitCode).toBe(0);
    expect(md).toContain("# Translation review report");
    expect(md).toContain("## data/Actors.json");
    expect(md).toContain("error · MAX_LENGTH_EXCEEDED");
    expect(md).toContain("source: Aria the Brave Knight of Dawn");
    expect(md).toContain("translation: Ария очень длинное имя");
  });

  it("prints the doc to stdout when no --out is given", async () => {
    const root = await createCliTempDir("rpgm-cli-report-stdout-");
    const { reportPath, unitsPath, translationsPath } = await seed(root);

    const stdout: string[] = [];
    const exitCode = await runCli(
      ["report", "summarize", reportPath, "--units", unitsPath, "--translations", translationsPath],
      { stdout: (text) => stdout.push(text), stderr: () => undefined }
    );

    expect(exitCode).toBe(0);
    expect(stdout.join("")).toContain("# Translation review report");
  });

  it("reports a clean report with no issues", async () => {
    const root = await createCliTempDir("rpgm-cli-report-clean-");
    const unitsPath = path.join(root, "units.json");
    const translationsPath = path.join(root, "translations.json");
    const reportPath = path.join(root, "report.json");
    await writeJsonFixture(unitsPath, [actorNameUnit()]);
    await writeJsonFixture(translationsPath, [{ id: "Actors.1.name", source: "Aria", translation: "Ария", status: "translated" }]);
    await writeJsonFixture(reportPath, {
      schemaVersion: 1,
      engine: "rpgmaker-mv",
      filesScanned: 1,
      unitsExtracted: 1,
      unitsTranslated: 1,
      fromMemory: 0,
      failed: 0,
      validationIssues: []
    });

    const stdout: string[] = [];
    await runCli(["report", "summarize", reportPath, "--units", unitsPath, "--translations", translationsPath], {
      stdout: (text) => stdout.push(text),
      stderr: () => undefined
    });

    expect(stdout.join("")).toContain("No validation issues");
  });
});
