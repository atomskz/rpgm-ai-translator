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
