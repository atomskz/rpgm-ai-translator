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

import type { TranslationReport, TranslationResult, TranslationUnit } from "../types/public-api.js";

const SEVERITY_ORDER: Record<string, number> = { error: 0, warning: 1, info: 2 };

function inlineCode(value: string): string {
  // Render a value inline; collapse newlines so a multi-line translation stays on
  // one Markdown line, and trim to keep the doc scannable.
  const collapsed = value.replace(/\r?\n/g, " ⏎ ").trim();
  return collapsed.length > 0 ? collapsed : "(empty)";
}

// Join a validation report's issues to the source text, translation and file
// location they refer to, grouped by file and ordered by severity, as a Markdown
// document a human can read and act on without parsing the JSON report.
export function summarizeReportToMarkdown(
  report: TranslationReport,
  units: TranslationUnit[],
  translations: TranslationResult[]
): string {
  const unitById = new Map(units.map((unit) => [unit.id, unit]));
  const translationById = new Map(translations.map((translation) => [translation.id, translation]));

  const errorCount = report.validationIssues.filter((issue) => issue.severity === "error").length;
  const warningCount = report.validationIssues.filter((issue) => issue.severity === "warning").length;

  const lines: string[] = [
    "# Translation review report",
    "",
    `- Engine: ${report.engine}`,
    `- Units: ${report.unitsExtracted} extracted, ${report.unitsTranslated} translated, ${report.fromMemory} from memory, ${report.failed} failed`,
    `- Issues: ${report.validationIssues.length} (${errorCount} errors, ${warningCount} warnings)`,
    ""
  ];

  if (report.validationIssues.length === 0) {
    lines.push("No validation issues. ✅", "");
    return `${lines.join("\n")}`;
  }

  // Group issues by the file of their unit; issues without a resolvable unit go
  // under a catch-all so a provider-level error is still surfaced.
  const byFile = new Map<string, typeof report.validationIssues>();
  for (const issue of report.validationIssues) {
    const file = (issue.id && unitById.get(issue.id)?.filePath) || "(no associated file)";
    const group = byFile.get(file) ?? [];
    group.push(issue);
    byFile.set(file, group);
  }

  for (const file of [...byFile.keys()].sort()) {
    const group = byFile
      .get(file)!
      .slice()
      .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3));
    lines.push(`## ${file} (${group.length} issue${group.length === 1 ? "" : "s"})`, "");
    group.forEach((issue, index) => {
      const unit = issue.id ? unitById.get(issue.id) : undefined;
      const translation = issue.id ? translationById.get(issue.id) : undefined;
      lines.push(`${index + 1}. **${issue.severity} · ${issue.code}** — ${inlineCode(issue.message)}`);
      if (issue.id) {
        lines.push(`   - id: \`${issue.id}\``);
      }
      if (unit) {
        lines.push(`   - where: \`${unit.jsonPath}\` (${unit.category})`);
        lines.push(`   - source: ${inlineCode(unit.source)}`);
      }
      if (translation) {
        lines.push(`   - translation: ${inlineCode(translation.translation)}`);
      }
      lines.push("");
    });
  }

  return `${lines.join("\n")}`;
}
