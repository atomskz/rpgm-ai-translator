import type { EngineId } from "./engine.js";
import type { ValidationIssue } from "./validation.js";

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
    // Path inside the stringified JSON as discrete segments. Used for traversal
    // so an object key that contains a literal `.` is not mis-split. The dotted
    // `encodedJsonPath` is retained for the unit id and backward compatibility.
    encodedJsonSegments?: string[];
  };
  placeholders?: Placeholder[];
  hash: string;
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

// Provider-neutral token usage. Each provider maps its own usage payload into
// this shape so cost/usage aggregation does not depend on a vendor's field names.
export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
};

export type TranslationMetadata = {
  usage?: ProviderUsage;
  tokenUsage?: TokenUsage;
  reviewed?: boolean;
  repaired?: boolean;
  repairMode?: "translate" | "review";
  fromMemory?: boolean;
  fromCheckpoint?: boolean;
  [key: string]: unknown;
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
