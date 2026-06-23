import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli/app.js";
import { actorNameUnit, createCliTempDir, writeJsonFixture } from "./cli/helpers.js";

describe("CLI validate and repair", () => {
  it("validates translations and writes a report", async () => {
    const root = await createCliTempDir("rpgm-cli-validate-");
    const unitsPath = path.join(root, "units.json");
    const translationsPath = path.join(root, "translations.json");
    const reportPath = path.join(root, "report.json");
    await writeJsonFixture(unitsPath, [actorNameUnit()]);
    await writeJsonFixture(translationsPath, [{ id: "Unknown.1.name", source: "???", translation: "???" }]);
    const output: string[] = [];

    const exitCode = await runCli(["validate", unitsPath, translationsPath, "--out", reportPath], {
      stdout: (text) => output.push(text),
      stderr: () => undefined
    });

    const report = JSON.parse(await readFile(reportPath, "utf8"));
    // Both issues are error severity, so validate gates with a non-zero code.
    expect(exitCode).toBe(2);
    expect(output.join("")).toContain("Validation issues: 2");
    expect(report.validationIssues.map((issue: { code: string }) => issue.code)).toEqual([
      "UNKNOWN_TRANSLATION_ID",
      "MISSING_TRANSLATION"
    ]);
  });

  it("exits 0 when no apply-blocking errors are found", async () => {
    const root = await createCliTempDir("rpgm-cli-validate-clean-");
    const unitsPath = path.join(root, "units.json");
    const translationsPath = path.join(root, "translations.json");
    const reportPath = path.join(root, "report.json");
    await writeJsonFixture(unitsPath, [actorNameUnit()]);
    await writeJsonFixture(translationsPath, [{ id: "Actors.1.name", source: "Aria", translation: "Ария" }]);

    const exitCode = await runCli(["validate", unitsPath, translationsPath, "--out", reportPath], {
      stdout: () => undefined,
      stderr: () => undefined
    });

    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(exitCode).toBe(0);
    expect(report.validationIssues).toEqual([]);
  });

  it("uses glossary during validation", async () => {
    const root = await createCliTempDir("rpgm-cli-glossary-");
    const unitsPath = path.join(root, "units.json");
    const translationsPath = path.join(root, "translations.json");
    const glossaryPath = path.join(root, "glossary.json");
    const reportPath = path.join(root, "report.json");
    await writeJsonFixture(unitsPath, [actorNameUnit()]);
    await writeJsonFixture(translationsPath, [{ id: "Actors.1.name", source: "Aria", translation: "Ариа" }]);
    await writeJsonFixture(glossaryPath, { Aria: { mode: "custom", translation: "Ария" } });

    const exitCode = await runCli(["validate", unitsPath, translationsPath, "--out", reportPath, "--glossary", glossaryPath], {
      stdout: () => undefined,
      stderr: () => undefined
    });

    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(exitCode).toBe(0);
    expect(report.validationIssues).toContainEqual(
      expect.objectContaining({ code: "GLOSSARY_VIOLATION" })
    );
  });

  it("repairs translations listed in a validation report", async () => {
    const root = await createCliTempDir("rpgm-cli-repair-");
    const unitsPath = path.join(root, "units.json");
    const translationsPath = path.join(root, "translations.json");
    const reportPath = path.join(root, "report.json");
    const outPath = path.join(root, "translations.repaired.json");
    await writeJsonFixture(unitsPath, [actorNameUnit()]);
    await writeJsonFixture(translationsPath, []);
    await writeJsonFixture(reportPath, {
      engine: "rpgmaker-mv",
      filesScanned: 1,
      unitsExtracted: 1,
      unitsTranslated: 0,
      fromMemory: 0,
      failed: 0,
      validationIssues: [
        {
          id: "Actors.1.name",
          severity: "error",
          code: "MISSING_TRANSLATION",
          message: "Missing translation"
        }
      ]
    });

    const output: string[] = [];
    const exitCode = await runCli(
      [
        "repair",
        unitsPath,
        translationsPath,
        "--report",
        reportPath,
        "--provider",
        "mock",
        "--target",
        "ru",
        "--attempts",
        "2",
        "--out",
        outPath
      ],
      {
        stdout: (text) => output.push(text),
        stderr: () => undefined
      }
    );

    const repaired = JSON.parse(await readFile(outPath, "utf8"));
    const checkpointLines = (await readFile(path.join(root, "translations.repaired.jsonl"), "utf8")).trim().split(/\r?\n/);
    expect(exitCode).toBe(0);
    expect(output.join("")).toContain("Repaired: 1");
    expect(output.join("")).toContain("remaining targeted issues:");
    expect(checkpointLines).toHaveLength(1);
    expect(repaired).toEqual([
      expect.objectContaining({
        id: "Actors.1.name",
        translation: "[ru] Aria",
        metadata: { repaired: true, repairMode: "translate" }
      })
    ]);
  });
});
