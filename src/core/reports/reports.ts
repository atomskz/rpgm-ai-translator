/*
 * This file is part of rpgm-ai-translator.
 *
 * Copyright (C) 2026 Nikita Fedorov
 *
 * rpgm-ai-translator is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * rpgm-ai-translator is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with rpgm-ai-translator. If not, see <https://www.gnu.org/licenses/>.
 */

import { readFile } from "node:fs/promises";
import type { EngineId, TranslationReport, TranslationResult, TranslationUnit, ValidationIssue } from "../types/public-api.js";
import { aggregateTokenUsage } from "../cost.js";
import { writeFileAtomic } from "../utils/fs.js";
import { hashCacheKey } from "../utils/hash.js";

// Bumped when TranslationReport changes incompatibly; readReportFile refuses a
// report stamped with a higher version than this build understands.
export const REPORT_SCHEMA_VERSION = 1;

// Stable digest of the units a report/translation set was built from, used to
// detect a report paired with a different units file. Order-independent (sorted)
// and based on each unit's id + content hash.
export function reportUnitsFingerprint(units: Pick<TranslationUnit, "id" | "hash">[]): string {
  const material = units
    .map((unit) => `${unit.id}:${unit.hash}`)
    .sort()
    .join("\n");
  return hashCacheKey(material);
}

export type ReportInput = {
  units: TranslationUnit[];
  translations?: TranslationResult[];
  validationIssues?: ValidationIssue[];
  fromMemory?: number;
  engine?: EngineId;
  warnings?: string[];
};

export function createReport(input: ReportInput): TranslationReport {
  const engine = input.engine ?? input.units[0]?.engine ?? "rpgmaker-mv";
  const translations = input.translations ?? [];
  const validationIssues = input.validationIssues ?? [];
  const issueSummary = summarizeIssues(input.units, validationIssues);

  const report: TranslationReport = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    unitsFingerprint: reportUnitsFingerprint(input.units),
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
  if (input.warnings && input.warnings.length > 0) {
    report.warnings = input.warnings;
  }
  const tokenUsage = aggregateTokenUsage(translations);
  if (tokenUsage) {
    report.tokenUsage = tokenUsage;
  }
  return report;
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
  const version = (parsed as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version === "number" && version > REPORT_SCHEMA_VERSION) {
    throw new Error(
      `Report '${filePath}' has schema version ${version}, newer than this build supports (${REPORT_SCHEMA_VERSION}). Regenerate it with a matching version.`
    );
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

  if (report.tokenUsage) {
    lines.push(
      `Token usage: ${report.tokenUsage.totalTokens ?? 0} total (${report.tokenUsage.inputTokens ?? 0} in, ${report.tokenUsage.outputTokens ?? 0} out)`
    );
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
    // A report written before schemaVersion existed reads as legacy (0).
    schemaVersion: typeof report.schemaVersion === "number" ? report.schemaVersion : 0,
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
    (candidate.schemaVersion == null || typeof candidate.schemaVersion === "number") &&
    (candidate.unitsFingerprint == null || typeof candidate.unitsFingerprint === "string") &&
    (candidate.engine === "rpgmaker-mv" || candidate.engine === "rpgmaker-mz") &&
    typeof candidate.filesScanned === "number" &&
    typeof candidate.unitsExtracted === "number" &&
    typeof candidate.unitsTranslated === "number" &&
    typeof candidate.fromMemory === "number" &&
    typeof candidate.failed === "number" &&
    (candidate.issuesByCode == null || isCountMap(candidate.issuesByCode)) &&
    (candidate.issuesByFile == null || isCountMap(candidate.issuesByFile)) &&
    (candidate.issuesByCategory == null || isCountMap(candidate.issuesByCategory)) &&
    (candidate.warnings == null || (Array.isArray(candidate.warnings) && candidate.warnings.every((item) => typeof item === "string"))) &&
    (candidate.tokenUsage == null || (typeof candidate.tokenUsage === "object" && !Array.isArray(candidate.tokenUsage))) &&
    Array.isArray(candidate.validationIssues)
  );
}
