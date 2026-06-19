import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EngineId, TranslationReport, TranslationResult, TranslationUnit, ValidationIssue } from "../types.js";

export type ReportInput = {
  units: TranslationUnit[];
  translations?: TranslationResult[];
  validationIssues?: ValidationIssue[];
  fromMemory?: number;
  engine?: EngineId;
};

export function createReport(input: ReportInput): TranslationReport {
  const engine = input.engine ?? input.units[0]?.engine ?? "rpgmaker-mv";
  const translations = input.translations ?? [];

  return {
    engine,
    filesScanned: new Set(input.units.map((unit) => unit.filePath)).size,
    unitsExtracted: input.units.length,
    unitsTranslated: translations.filter((result) => result.status === "translated").length,
    fromMemory:
      input.fromMemory ??
      translations.filter((result) => result.metadata && result.metadata.fromMemory === true).length,
    failed: translations.filter((result) => result.status === "failed").length,
    validationIssues: input.validationIssues ?? []
  };
}

export function createEmptyReport(engine: TranslationReport["engine"]): TranslationReport {
  return createReport({ engine, units: [] });
}

export async function writeReportFile(filePath: string, report: TranslationReport): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export function summarizeReport(report: TranslationReport): string {
  const errorCount = report.validationIssues.filter((issue) => issue.severity === "error").length;
  const warningCount = report.validationIssues.filter((issue) => issue.severity === "warning").length;
  return [
    `Engine: ${report.engine}`,
    `Files scanned: ${report.filesScanned}`,
    `Units extracted: ${report.unitsExtracted}`,
    `Units translated: ${report.unitsTranslated}`,
    `From memory: ${report.fromMemory}`,
    `Failed: ${report.failed}`,
    `Validation issues: ${report.validationIssues.length} (${errorCount} errors, ${warningCount} warnings)`
  ].join("\n");
}
