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

// Curated public API. All shared types are re-exported; values are listed
// explicitly so internal helpers (prompt construction, plugin/path internals,
// validator/memory internals) stay private and a future name clash cannot leak
// through a wildcard re-export.

// Types: the full shared type surface (the type modules contain no runtime values).
export type * from "./core/types/types.js";

// Engine detection, extraction and patching.
export {
  MvMzEngineDetector,
  RpgMakerMvMzExtractor,
  assertPatchOutputOutsideGame,
  writePatch,
  applyFontPatch,
  type FontPatchOptions,
  type FontPatchResult
} from "./engines/rpgmaker-mvmz/public-api.js";

// Placeholder protection (control-code round-tripping).
export {
  protectPlaceholders,
  restorePlaceholders,
  type PlaceholderProtectionResult
} from "./core/placeholders.js";

// Validation and reporting.
export {
  DefaultValidator,
  validateTranslationResults,
  filterTranslationsWithoutValidationErrors
} from "./core/validators/public-api.js";
export {
  REPORT_SCHEMA_VERSION,
  createReport,
  createEmptyReport,
  readReportFile,
  writeReportFile,
  reportUnitsFingerprint,
  summarizeReport,
  type ReportInput
} from "./core/reports/public-api.js";

// Translation-unit and result file I/O.
export {
  readTranslationUnitsFile,
  writeTranslationUnitsFile,
  readTranslationResultsFile,
  writeTranslationResultsFile,
  normalizeTranslationResults,
  resetTranslationResultsJsonlFile,
  appendTranslationResultsJsonlFile,
  readTranslationResultsJsonlFile,
  type ImportedTranslation
} from "./core/translation-units.js";

// Translation memory and pipeline passes.
export { JsonlTranslationMemory } from "./core/memory/public-api.js";
export { translateWithMemory } from "./core/memory/public-api.js";
export type { MemoryEntry, TranslationMemory } from "./core/memory/public-api.js";
export { reviewTranslations, type ReviewPassResult } from "./core/pipeline/public-api.js";
export { repairTranslations, type RepairOptions, type RepairResult } from "./core/pipeline/public-api.js";
export {
  extractCharacterCandidates,
  inferCharacterGlossary,
  candidatesToDraftGlossary,
  type CharacterExtractionOptions
} from "./core/pipeline/public-api.js";

// Providers.
export { MockProvider } from "./providers/public-api.js";
export { DeepSeekProvider, type DeepSeekProviderConfig } from "./providers/public-api.js";
export { createProvider, type ProviderName, type ProviderConfig } from "./providers/public-api.js";

// Plugin parsing types (the manipulation helpers stay internal to the patch writer).
export type { RpgMakerPlugin } from "./engines/rpgmaker-mvmz/public-api.js";

// Configuration loaders.
export { loadGlossary } from "./config/public-api.js";
export { loadCharacterGlossary } from "./config/public-api.js";
export {
  loadProjectConfig,
  PROJECT_CONFIG_FILENAME,
  CONFIG_FLAG,
  type ProjectConfig
} from "./config/public-api.js";
export { mergeConfigIntoArgs } from "./cli/config-args.js";
