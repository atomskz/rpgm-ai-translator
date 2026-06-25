import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createReport, readReportFile, summarizeReport, writeReportFile } from "../src/core/reports/public-api.js";
import type { TranslationResult, TranslationUnit, ValidationIssue } from "../src/core/types/public-api.js";

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
      schemaVersion: 1,
      unitsFingerprint: expect.any(String),
      engine: "rpgmaker-mv",
      filesScanned: 1,
      unitsExtracted: 2,
      unitsTranslated: 1,
      fromMemory: 1,
      failed: 1,
      issuesByCode: { MISSING_TRANSLATION: 1 },
      issuesByFile: { "data/Actors.json": 1 },
      issuesByCategory: { name: 1 },
      validationIssues: issues
    });
  });

  it("aggregates provider-neutral token usage across translations", () => {
    const report = createReport({
      units: [unit("Actors.1.name"), unit("Actors.2.name")],
      translations: [
        { ...result("Actors.1.name", "translated"), metadata: { tokenUsage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 } } },
        { ...result("Actors.2.name", "translated"), metadata: { tokenUsage: { inputTokens: 6, outputTokens: 2, totalTokens: 8 } } }
      ]
    });

    expect(report.tokenUsage).toEqual({ inputTokens: 16, outputTokens: 6, totalTokens: 22, cachedInputTokens: 0 });
    expect(summarizeReport(report)).toContain("Token usage: 22 total (16 in, 6 out)");
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
    expect(summary).toContain("Top issue codes: UNCHANGED_TRANSLATION=1");
  });

  it("writes report JSON files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-report-"));
    const reportPath = path.join(root, "nested", "report.json");
    const report = createReport({ units: [unit("Actors.1.name")] });

    await writeReportFile(reportPath, report);

    expect(JSON.parse(await readFile(reportPath, "utf8"))).toEqual(report);
    await expect(readReportFile(reportPath)).resolves.toEqual(report);
  });

  it("reads old report files without issue summaries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-report-old-"));
    const reportPath = path.join(root, "report.json");
    await writeReportFile(reportPath, createReport({ units: [unit("Actors.1.name")] }));
    const parsed = JSON.parse(await readFile(reportPath, "utf8"));
    delete parsed.issuesByCode;
    delete parsed.issuesByFile;
    delete parsed.issuesByCategory;
    await writeFile(reportPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");

    await expect(readReportFile(reportPath)).resolves.toEqual(
      expect.objectContaining({
        issuesByCode: {},
        issuesByFile: {},
        issuesByCategory: {}
      })
    );
  });

  it("reads a legacy report without a schema version as version 0", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-report-legacy-"));
    const reportPath = path.join(root, "report.json");
    await writeReportFile(reportPath, createReport({ units: [unit("Actors.1.name")] }));
    const parsed = JSON.parse(await readFile(reportPath, "utf8"));
    delete parsed.schemaVersion;
    await writeFile(reportPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");

    await expect(readReportFile(reportPath)).resolves.toEqual(expect.objectContaining({ schemaVersion: 0 }));
  });

  it("refuses a report with a newer schema version", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-report-newer-"));
    const reportPath = path.join(root, "report.json");
    await writeReportFile(reportPath, createReport({ units: [unit("Actors.1.name")] }));
    const parsed = JSON.parse(await readFile(reportPath, "utf8"));
    parsed.schemaVersion = 999;
    await writeFile(reportPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");

    await expect(readReportFile(reportPath)).rejects.toThrow("newer than this build supports");
  });

  it("derives a units fingerprint that changes with the units", () => {
    const a = createReport({ units: [unit("Actors.1.name")] });
    const b = createReport({ units: [unit("Actors.2.name")] });
    expect(a.unitsFingerprint).toEqual(expect.any(String));
    expect(a.unitsFingerprint).not.toBe(b.unitsFingerprint);
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
