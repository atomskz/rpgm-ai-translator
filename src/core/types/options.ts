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

import type { CharacterGlossary, Glossary } from "./glossary.js";
import type { TranslationCategory, TranslationResult } from "./translation.js";

export type ApplyMode = "patch" | "in-place" | "export" | "import";

export type ApplyOptions = {
  mode: ApplyMode;
  outDir?: string;
  backupDir?: string;
  includePlugins?: boolean;
  includeSpeakerNames?: boolean;
  // Compute what would be written (filesWritten/unitsApplied/skipped) without
  // creating or modifying any files.
  dryRun?: boolean;
};

export type ApplyResult = {
  mode: ApplyMode;
  filesWritten: string[];
  unitsApplied: number;
  skipped: number;
  backupDir?: string;
};

export type TranslateOptions = {
  sourceLanguage?: string;
  targetLanguage: string;
  model?: string;
  glossary?: Glossary;
  characterGlossary?: CharacterGlossary;
  timeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
  batchSize?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
  onProgress?: (event: TranslationProgressEvent) => void;
  onBatchResults?: (results: TranslationResult[]) => void | Promise<void>;
};

export type ReviewOptions = TranslateOptions & {
  reviewCategories?: TranslationCategory[];
};

export type CharacterInferenceOptions = TranslateOptions;

export type TranslationProgressEvent =
  | {
      type: "memory-hit";
      completed: number;
      total: number;
      unitId: string;
    }
  | {
      type: "batch-start";
      batchIndex: number;
      batchCount: number;
      batchSize: number;
      completed: number;
      total: number;
    }
  | {
      type: "batch-complete";
      batchIndex: number;
      batchCount: number;
      batchSize: number;
      translated: number;
      failed: number;
      completed: number;
      total: number;
      failures?: BatchFailureSummary[];
    }
  | {
      type: "batch-retry";
      batchIndex: number;
      batchCount: number;
      attempt: number;
      maxAttempts: number;
      message: string;
    }
  | {
      type: "review-batch-start";
      batchIndex: number;
      batchCount: number;
      batchSize: number;
      completed: number;
      total: number;
    }
  | {
      type: "review-batch-complete";
      batchIndex: number;
      batchCount: number;
      batchSize: number;
      reviewed: number;
      failed: number;
      completed: number;
      total: number;
      failures?: BatchFailureSummary[];
    };

// A distinct provider/validation failure reason aggregated across a batch, so
// the CLI can show why units failed (e.g. PROVIDER_NETWORK_ERROR) instead of a
// bare count. `count` is the number of failed-unit issues carrying this code.
export type BatchFailureSummary = {
  code: string;
  message: string;
  count: number;
};

export type ExtractOptions = {
  includeEventComments?: boolean;
  includePlugins?: boolean;
  includeSpeakerNames?: boolean;
  // Max display width (in cells) allowed for a single Show Text dialogue line,
  // baked into each dialogue unit's maxLength constraint. The fitting width
  // depends on the game's font, so it is overridable; when unset the built-in
  // DEFAULT_DIALOGUE_MAX_LENGTH is used.
  dialogueMaxLength?: number;
  // Called for each data or plugin file that could not be read or parsed and was
  // skipped, so one corrupt file does not abort extraction of the whole project.
  onWarning?: (warning: string) => void;
};
