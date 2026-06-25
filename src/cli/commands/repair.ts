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

import { repairTranslations } from "../../core/pipeline/repair.js";
import { readReportFile, reportUnitsFingerprint } from "../../core/reports/reports.js";
import {
  appendTranslationResultsJsonlFile,
  readTranslationResultsFile,
  readTranslationUnitsFile,
  writeTranslationResultsFile
} from "../../core/translation-units.js";
import { DefaultValidator, validateTranslationResults } from "../../core/validators/validators.js";
import { loadGlossary } from "../../config/public-api.js";
import { loadCharacterGlossary } from "../../config/public-api.js";
import { createProvider } from "../../providers/public-api.js";
import {
  checkpointedTranslationsById,
  checkpointSignature,
  defaultCheckpointPath,
  mergeCheckpointTranslations,
  resolveCheckpoint
} from "../checkpoints.js";
import {
  assertProviderReady,
  readIssueCodesOption,
  readOption,
  readProviderCliOptions,
  readProviderConfig,
  readProviderName,
  readPositiveIntegerOption,
  requireOption,
  requirePositional
} from "../options.js";
import { createProgressLogger } from "../progress.js";
import type { TranslationResult, ValidationIssue } from "../../core/types/types.js";
import type { CliIO } from "../types.js";

export async function repairCommand(args: string[], io: CliIO): Promise<number> {
  const unitsPath = requirePositional(args, 0, "units path");
  const translationsPath = requirePositional(args, 1, "translations path");
  const reportPath = requireOption(args, "--report");
  const out = requireOption(args, "--out");
  const providerName = readProviderName(args);
  assertProviderReady(providerName);
  const providerOptions = readProviderCliOptions(args);
  const checkpointOption = readOption(args, "--checkpoint");
  const glossaryPath = readOption(args, "--glossary");
  const charactersPath = readOption(args, "--characters");
  const issueCodes = readIssueCodesOption(args, "--codes");
  const attempts = readPositiveIntegerOption(args, "--attempts") ?? 1;
  const units = await readTranslationUnitsFile(unitsPath);
  let translations = await readTranslationResultsFile(translationsPath);
  const report = await readReportFile(reportPath);
  // A report built from a different extraction targets unit ids that may no longer
  // exist here, so repair would silently fix nothing. Warn rather than fail quietly.
  if (report.unitsFingerprint && report.unitsFingerprint !== reportUnitsFingerprint(units)) {
    io.stderr(
      "Warning: the report was generated from a different units file (id/hash fingerprint mismatch); " +
        "repair may target stale issues or skip units. Re-run validate against these units first.\n"
    );
  }
  const glossary = glossaryPath ? await loadGlossary(glossaryPath) : undefined;
  const characterGlossary = charactersPath ? await loadCharacterGlossary(charactersPath) : undefined;
  // Gate resume on the run signature so a checkpoint written for a different
  // target/model/glossary is discarded rather than mixing stale output into the
  // repair (e.g. resuming a --target en checkpoint under --target ru).
  const signature = checkpointSignature(providerName, providerOptions, glossary, characterGlossary);
  const { checkpointPath, results, stale, resumed } = await resolveCheckpoint({
    checkpointOption,
    derivedPath: defaultCheckpointPath(out),
    signature
  });
  const checkpointById = checkpointedTranslationsById(units, results);
  if (checkpointById.size > 0) {
    translations = mergeCheckpointTranslations(units, translations, checkpointById);
  }
  if (stale) {
    io.stderr("Warning: repair checkpoint parameters (language/model/glossary) changed; discarding it and repairing fresh.\n");
  }
  if (resumed) {
    io.stderr(`Loaded repair checkpoint: ${checkpointById.size}/${units.length} translated units from ${checkpointPath}\n`);
  }
  io.stderr(`Writing repair checkpoint: ${checkpointPath}\n`);
  io.stderr(`Repairing translations for ${issueCodes ? issueCodes.join(",") : "all"} validation issue codes...\n`);
  let validationIssues = filterValidationIssues(report.validationIssues, issueCodes, checkpointById);
  let repaired = 0;
  let translated = 0;
  let reviewed = 0;
  let failed = 0;
  let skipped = 0;
  const provider = createProvider(providerName, readProviderConfig(args));
  for (let attempt = 1; attempt <= attempts && validationIssues.length > 0; attempt += 1) {
    io.stderr(`Repair attempt ${attempt}/${attempts}: ${validationIssues.length} targeted issues...\n`);
    const result = await repairTranslations(units, translations, validationIssues, provider, {
      ...providerOptions,
      glossary,
      characterGlossary,
      issueCodes,
      onProgress: createProgressLogger(io),
      onBatchResults: async (batchResults) => {
        await appendTranslationResultsJsonlFile(checkpointPath, batchResults);
        io.stderr(`Repair checkpoint saved: ${batchResults.length} results.\n`);
      }
    });
    translations = result.translations;
    repaired += result.repaired;
    translated += result.translated;
    reviewed += result.reviewed;
    failed += result.failed;
    skipped += result.skipped;
    io.stderr(
      `Repair attempt ${attempt}/${attempts}: repaired ${result.repaired}, translated ${result.translated}, reviewed ${result.reviewed}, failed ${result.failed}, skipped ${result.skipped}\n`
    );
    if (result.repaired === 0) {
      break;
    }
    const currentIssues = validateTranslationResults(units, translations, new DefaultValidator(glossary));
    validationIssues = filterValidationIssues(currentIssues, issueCodes, new Map());
  }
  await writeTranslationResultsFile(out, translations);
  io.stderr(
    `Repaired: ${repaired}, translated: ${translated}, reviewed: ${reviewed}, failed: ${failed}, skipped: ${skipped}, remaining targeted issues: ${validationIssues.length}\n`
  );
  if (validationIssues.length > 0) {
    io.stderr(
      `Warning: ${validationIssues.length} targeted validation issue(s) remain unresolved. Validate again and review before applying this patch.\n`
    );
  }
  // Exit non-zero when blocking (error-severity) issues remain after the repair
  // budget is spent, so a `repair && apply` chain stops instead of shipping them.
  if (validationIssues.some((item) => item.severity === "error")) {
    return 2;
  }
  return 0;
}

function filterValidationIssues(
  validationIssues: ValidationIssue[],
  issueCodes: ValidationIssue["code"][] | undefined,
  skippedTranslationsById: Map<string, TranslationResult>
): ValidationIssue[] {
  const codeFilter = issueCodes ? new Set(issueCodes) : undefined;
  return validationIssues.filter((issue) => {
    if (issue.id && skippedTranslationsById.has(issue.id)) {
      return false;
    }
    return !codeFilter || codeFilter.has(issue.code);
  });
}
