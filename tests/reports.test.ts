import { mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createReport, summarizeReport, writeReportFile } from "../src/core/reports/index.js";
import type { TranslationResult, TranslationUnit, ValidationIssue } from "../src/core/types.js";

describe("reports", () => {
  it("builds JSON reports from units, translations and validation issues", () => {
    const issues: ValidationIssue[] = [
      {
        id: "Actors.2.name",
        severity: "error",
        code: "MISSING_TRANSLATION",
        message: "Missing translation"
      }
    ];

    const report = createReport({
      units: [unit("Actors.1.name"), unit("Actors.2.name")],
      translations: [
        result("Actors.1.name", "translated"),
        { ...result("Actors.2.name", "failed"), metadata: { fromMemory: true } }
      ],
      validationIssues: issues
    });

    expect(report).toEqual({
      engine: "rpgmaker-mv",
      filesScanned: 1,
      unitsExtracted: 2,
      unitsTranslated: 1,
      fromMemory: 1,
      failed: 1,
      validationIssues: issues
    });
  });

  it("creates human-readable summaries", () => {
    const summary = summarizeReport(
      createReport({
        units: [unit("Actors.1.name")],
        translations: [result("Actors.1.name", "translated")],
        validationIssues: [
          {
            id: "Actors.1.name",
            severity: "warning",
            code: "UNCHANGED_TRANSLATION",
            message: "Unchanged"
          }
        ]
      })
    );

    expect(summary).toContain("Engine: rpgmaker-mv");
    expect(summary).toContain("Validation issues: 1 (0 errors, 1 warnings)");
  });

  it("writes report JSON files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-report-"));
    const reportPath = path.join(root, "nested", "report.json");
    const report = createReport({ units: [unit("Actors.1.name")] });

    await writeReportFile(reportPath, report);

    expect(JSON.parse(await readFile(reportPath, "utf8"))).toEqual(report);
  });
});

function unit(id: string): TranslationUnit {
  return {
    id,
    source: "Aria",
    filePath: "data/Actors.json",
    jsonPath: "1.name",
    engine: "rpgmaker-mv",
    category: "name",
    hash: "hash"
  };
}

function result(id: string, status: TranslationResult["status"]): TranslationResult {
  return {
    id,
    source: "Aria",
    translation: status === "translated" ? "Ария" : "",
    provider: "mock",
    model: "mock",
    status
  };
}
