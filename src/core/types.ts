export type EngineId = "rpgmaker-mv" | "rpgmaker-mz";
export type DetectedEngineId = EngineId | "unknown";

export type TranslationCategory =
  | "dialogue"
  | "choice"
  | "name"
  | "description"
  | "system"
  | "plugin-parameter"
  | "unknown";

export type Placeholder = {
  token: string;
  value: string;
  required: boolean;
  kind: "control-code" | "format-token" | "template-token" | "tag";
};

export type TranslationUnit = {
  id: string;
  source: string;
  normalizedSource?: string;
  filePath: string;
  jsonPath: string;
  engine: EngineId;
  category: TranslationCategory;
  context?: {
    mapName?: string;
    eventId?: number;
    eventName?: string;
    speaker?: string;
    previousLines?: string[];
    nextLines?: string[];
  };
  constraints?: {
    preserveNewlines?: boolean;
    preserveControlCodes?: boolean;
    maxLines?: number;
    maxLength?: number;
    sourceEncoding?: "json-string-literal" | "json-stringified-json";
    encodedJsonPath?: string;
  };
  placeholders?: Placeholder[];
  hash: string;
};

export type ValidationIssue = {
  id?: string;
  severity: "info" | "warning" | "error";
  code:
    | "INVALID_JSON"
    | "ID_MISMATCH"
    | "UNKNOWN_TRANSLATION_ID"
    | "MISSING_TRANSLATION"
    | "MISSING_PLACEHOLDER"
    | "EXTRA_PLACEHOLDER"
    | "DUPLICATE_PLACEHOLDER"
    | "CONTROL_CODE_CHANGED"
    | "NUMBER_CHANGED"
    | "VARIABLE_CHANGED"
    | "MAX_LENGTH_EXCEEDED"
    | "MAX_LINES_EXCEEDED"
    | "EMPTY_TRANSLATION"
    | "UNCHANGED_TRANSLATION"
    | "GLOSSARY_VIOLATION"
    | "TECHNICAL_TOKEN_CHANGED";
  message: string;
};

export type TranslationResult = {
  id: string;
  source: string;
  translation: string;
  provider: string;
  model: string;
  status: "translated" | "failed" | "skipped";
  issues?: ValidationIssue[];
  metadata?: TranslationMetadata;
};

export type ProviderUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: ProviderUsageDetails;
  completion_tokens_details?: ProviderUsageDetails;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  [key: string]: unknown;
};

export type ProviderUsageDetails = {
  cached_tokens?: number;
  [key: string]: unknown;
};

export type TranslationMetadata = {
  usage?: ProviderUsage;
  reviewed?: boolean;
  repaired?: boolean;
  repairMode?: "translate" | "review";
  fromMemory?: boolean;
  fromCheckpoint?: boolean;
  [key: string]: unknown;
};

export type DetectedEngine = {
  engine: DetectedEngineId;
  rootPath: string;
  projectPath: string;
  dataPath?: string;
  pluginsPath?: string;
  confidence: "high" | "medium" | "low";
  reasons: string[];
};

export type ApplyMode = "patch" | "in-place" | "export" | "import";

export type ApplyOptions = {
  mode: ApplyMode;
  outDir?: string;
  backupDir?: string;
  includePlugins?: boolean;
  includeSpeakerNames?: boolean;
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
};

export type GlossaryMode = "keep" | "translate" | "transliterate" | "custom";

export type Glossary = Record<
  string,
  {
    translation?: string;
    mode: GlossaryMode;
  }
>;

export type CharacterGender = "male" | "female" | "neutral" | "unknown";

export type CharacterKind = "person" | "place" | "group" | "creature" | "object" | "unknown";

export type CharacterGlossary = Record<
  string,
  {
    gender?: CharacterGender;
    type?: CharacterKind;
    translation?: string;
    aliases?: string[];
    description?: string;
    speechStyle?: string;
    confidence?: number;
    review?: boolean;
  }
>;

export type CharacterCandidate = {
  name: string;
  suggestedTranslation?: string;
  sources: Array<"actor" | "speaker" | "event" | "dialogue-mention">;
  occurrences: number;
  evidence: Array<{
    unitId: string;
    category: TranslationCategory;
    source: string;
    translation?: string;
    context?: TranslationUnit["context"];
  }>;
};

export type ReviewUnit = {
  id: string;
  source: string;
  currentTranslation: string;
  normalizedSource?: string;
  category: TranslationCategory;
  context?: TranslationUnit["context"];
  constraints?: TranslationUnit["constraints"];
  placeholders?: Placeholder[];
  issues?: ValidationIssue[];
};

export type TranslationReport = {
  engine: EngineId;
  filesScanned: number;
  unitsExtracted: number;
  unitsTranslated: number;
  fromMemory: number;
  failed: number;
  issuesByCode: Record<string, number>;
  issuesByFile: Record<string, number>;
  issuesByCategory: Record<string, number>;
  validationIssues: ValidationIssue[];
};

export interface EngineDetector {
  detect(projectPath: string): Promise<DetectedEngine>;
}

export interface Extractor {
  extract(projectPath: string, options?: ExtractOptions): Promise<TranslationUnit[]>;
  applyTranslations(
    projectPath: string,
    translations: TranslationResult[],
    options: ApplyOptions
  ): Promise<ApplyResult>;
}

export interface LLMProvider {
  readonly name: string;
  translateBatch(
    batch: TranslationUnit[],
    options: TranslateOptions
  ): Promise<TranslationResult[]>;
  reviewBatch(
    batch: ReviewUnit[],
    options: ReviewOptions
  ): Promise<TranslationResult[]>;
  inferCharacters(
    candidates: CharacterCandidate[],
    options: CharacterInferenceOptions
  ): Promise<CharacterGlossary>;
}

export interface Validator {
  validate(unit: TranslationUnit, result: TranslationResult): ValidationIssue[];
}
