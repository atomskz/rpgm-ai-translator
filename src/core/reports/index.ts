import { readFile } from "node:fs/promises";
import type { EngineId, TranslationReport, TranslationResult, TranslationUnit, ValidationIssue } from "../types.js";
import { writeFileAtomic } from "../utils/fs.js";

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
  const validationIssues = input.validationIssues ?? [];
  const issueSummary = summarizeIssues(input.units, validationIssues);

  return {
    engine,
    filesScanned: new Set(input.units.map((unit) => unit.filePath)).size,
    unitsExtracted: input.units.length,
    unitsTranslated: translations.filter((result) => result.status === "translated").length,
    fromMemory:
      input.fromMemory ??
      translations.filter((result) => result.metadata && result.metadata.fromMemory === true).length,
    failed: translations.filter((result) => result.status === "failed").length,
    issuesByCode: issueSummary.byCode,
    issuesByFile: issueSummary.byFile,
    issuesByCategory: issueSummary.byCategory,
    validationIssues
  };
}

export function createEmptyReport(engine: TranslationReport["engine"]): TranslationReport {
  return createReport({ engine, units: [] });
}

export async function writeReportFile(filePath: string, report: TranslationReport): Promise<void> {
  await writeFileAtomic(filePath, `${JSON.stringify(report, null, 2)}\n`);
}

export async function readReportFile(filePath: string): Promise<TranslationReport> {
  const raw = await readFile(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    throw new Error(`Invalid report JSON in '${filePath}': ${error instanceof Error ? error.message : String(error)}`, {
      cause: error
    });
  }

  if (!isTranslationReport(parsed)) {
    throw new Error("Report file must contain a translation report object");
  }
  return normalizeReport(parsed);
}

export function summarizeReport(report: TranslationReport): string {
  const errorCount = report.validationIssues.filter((issue) => issue.severity === "error").length;
  const warningCount = report.validationIssues.filter((issue) => issue.severity === "warning").length;
  const lines = [
    `Engine: ${report.engine}`,
    `Files scanned: ${report.filesScanned}`,
    `Units extracted: ${report.unitsExtracted}`,
    `Units translated: ${report.unitsTranslated}`,
    `From memory: ${report.fromMemory}`,
    `Failed: ${report.failed}`,
    `Validation issues: ${report.validationIssues.length} (${errorCount} errors, ${warningCount} warnings)`
  ];

  const topCodes = topEntries(report.issuesByCode, 5);
  if (topCodes.length > 0) {
    lines.push(`Top issue codes: ${topCodes.map(([code, count]) => `${code}=${count}`).join(", ")}`);
  }

  return lines.join("\n");
}

function summarizeIssues(
  units: TranslationUnit[],
  validationIssues: ValidationIssue[]
): { byCode: Record<string, number>; byFile: Record<string, number>; byCategory: Record<string, number> } {
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  const byCode: Record<string, number> = {};
  const byFile: Record<string, number> = {};
  const byCategory: Record<string, number> = {};

  for (const issue of validationIssues) {
    increment(byCode, issue.code);
    const unit = issue.id ? unitsById.get(issue.id) : undefined;
    increment(byFile, unit?.filePath ?? "unknown");
    increment(byCategory, unit?.category ?? "unknown");
  }

  return { byCode, byFile, byCategory };
}

function normalizeReport(report: TranslationReport): TranslationReport {
  const fallbackByCode: Record<string, number> = {};
  for (const issue of report.validationIssues) {
    increment(fallbackByCode, issue.code);
  }

  return {
    ...report,
    issuesByCode: isCountMap(report.issuesByCode) ? report.issuesByCode : fallbackByCode,
    issuesByFile: isCountMap(report.issuesByFile) ? report.issuesByFile : {},
    issuesByCategory: isCountMap(report.issuesByCategory) ? report.issuesByCategory : {}
  };
}

function increment(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function topEntries(map: Record<string, number>, limit: number): Array<[string, number]> {
  return Object.entries(map)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit);
}

function isCountMap(value: unknown): value is Record<string, number> {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((item) => typeof item === "number");
}

function isTranslationReport(value: unknown): value is TranslationReport {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<TranslationReport>;
  return (
    (candidate.engine === "rpgmaker-mv" || candidate.engine === "rpgmaker-mz") &&
    typeof candidate.filesScanned === "number" &&
    typeof candidate.unitsExtracted === "number" &&
    typeof candidate.unitsTranslated === "number" &&
    typeof candidate.fromMemory === "number" &&
    typeof candidate.failed === "number" &&
    (candidate.issuesByCode == null || isCountMap(candidate.issuesByCode)) &&
    (candidate.issuesByFile == null || isCountMap(candidate.issuesByFile)) &&
    (candidate.issuesByCategory == null || isCountMap(candidate.issuesByCategory)) &&
    Array.isArray(candidate.validationIssues)
  );
}
