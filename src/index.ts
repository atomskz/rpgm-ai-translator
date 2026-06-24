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
export type * from "./core/types.js";

// Engine detection, extraction and patching.
export { MvMzEngineDetector } from "./core/engine-detector/index.js";
export { RpgMakerMvMzExtractor } from "./core/extractors/index.js";
export { assertPatchOutputOutsideGame, writePatch } from "./core/patch-writer/index.js";
export { applyFontPatch, type FontPatchOptions, type FontPatchResult } from "./core/font-patch/index.js";

// Placeholder protection (control-code round-tripping).
export {
  protectPlaceholders,
  restorePlaceholders,
  type PlaceholderProtectionResult
} from "./core/placeholders/index.js";

// Validation and reporting.
export {
  DefaultValidator,
  validateTranslationResults,
  filterTranslationsWithoutValidationErrors
} from "./core/validators/index.js";
export {
  REPORT_SCHEMA_VERSION,
  createReport,
  createEmptyReport,
  readReportFile,
  writeReportFile,
  reportUnitsFingerprint,
  summarizeReport,
  type ReportInput
} from "./core/reports/index.js";

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
} from "./core/translation-units/index.js";

// Translation memory and pipeline passes.
export {
  JsonlTranslationMemory,
  translateWithMemory,
  type MemoryEntry,
  type TranslationMemory
} from "./core/memory/index.js";
export { reviewTranslations, type ReviewPassResult } from "./core/review/index.js";
export { repairTranslations, type RepairOptions, type RepairResult } from "./core/repair/index.js";
export {
  extractCharacterCandidates,
  inferCharacterGlossary,
  candidatesToDraftGlossary,
  type CharacterExtractionOptions
} from "./core/characters/index.js";

// Providers.
export { MockProvider } from "./providers/mock/index.js";
export { DeepSeekProvider, type DeepSeekProviderConfig } from "./providers/deepseek/index.js";
export { createProvider, type ProviderName, type ProviderConfig } from "./providers/index.js";

// Plugin parsing types (the manipulation helpers stay internal to the patch writer).
export type { RpgMakerPlugin } from "./core/plugins/index.js";

// Configuration loaders.
export { loadGlossary, loadCharacterGlossary } from "./config/index.js";
export {
  loadProjectConfig,
  mergeConfigIntoArgs,
  PROJECT_CONFIG_FILENAME,
  CONFIG_FLAG,
  type ProjectConfig
} from "./config/project.js";
