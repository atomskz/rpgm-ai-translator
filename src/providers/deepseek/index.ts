import type {
  LLMProvider,
  CharacterCandidate,
  CharacterGlossary,
  CharacterInferenceOptions,
  ReviewOptions,
  ReviewUnit,
  TranslateOptions,
  TranslationResult,
  TranslationUnit,
  ValidationIssue,
  ProviderUsage
} from "../../core/types.js";
import {
  type ChatMessage,
  buildCharacterInferenceMessages,
  buildReviewMessages,
  buildTranslationMessages
} from "../prompt-builder.js";

type FetchLike = (url: string, init: DeepSeekRequestInit) => Promise<DeepSeekResponse>;

type DeepSeekRequestInit = {
  method: "POST";
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
};

type DeepSeekResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
};

type DeepSeekProviderConfig = {
  apiKey?: string;
  baseUrl?: string;
  fetchFn?: FetchLike;
  maxRetries?: number;
  retryDelayMs?: number;
};

type DeepSeekThinkingMode = "enabled" | "disabled";

type ChatCompletionResponse = {
  choices: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  usage?: ProviderUsage;
};

type ModelTranslationPayload = {
  translations: Array<{
    id: string;
    translation: string;
  }>;
};

type ModelCharactersPayload = {
  characters: CharacterGlossary;
};

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-v4-flash";

export class DeepSeekProvider implements LLMProvider {
  readonly name = "deepseek";

  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(config: DeepSeekProviderConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.DEEPSEEK_API_KEY;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchFn = config.fetchFn ?? ((url, init) => fetch(url, init) as Promise<DeepSeekResponse>);
    this.maxRetries = config.maxRetries ?? 2;
    this.retryDelayMs = config.retryDelayMs ?? 250;
  }

  async translateBatch(batch: TranslationUnit[], options: TranslateOptions): Promise<TranslationResult[]> {
    const model = options.model ?? DEFAULT_MODEL;
    if (batch.length === 0) {
      return [];
    }

    if (!this.apiKey) {
      return batch.map((unit) => this.failedResult(unit, model, "Missing DEEPSEEK_API_KEY"));
    }

    try {
      const response = await this.requestChatCompletion(buildTranslationMessages(batch, options), options, model, "disabled");
      const payload = parseModelPayload(response);
      const byId = new Map(payload.translations.map((item) => [item.id, item.translation]));
      const usage = response.usage;

      return batch.map((unit) => {
        const translation = byId.get(unit.id);
        if (typeof translation !== "string") {
          return this.failedResult(unit, model, `Missing translation for unit '${unit.id}'`);
        }

        return {
          id: unit.id,
          source: unit.source,
          translation,
          provider: this.name,
          model,
          status: "translated",
          metadata: usage ? { usage } : undefined
        };
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return batch.map((unit) => this.failedResult(unit, model, message));
    }
  }

  async reviewBatch(batch: ReviewUnit[], options: ReviewOptions): Promise<TranslationResult[]> {
    const model = options.model ?? DEFAULT_MODEL;
    if (batch.length === 0) {
      return [];
    }

    if (!this.apiKey) {
      return batch.map((unit) => this.failedReviewResult(unit, model, "Missing DEEPSEEK_API_KEY"));
    }

    try {
      const response = await this.requestChatCompletion(buildReviewMessages(batch, options), options, model, "enabled");
      const payload = parseModelPayload(response);
      const byId = new Map(payload.translations.map((item) => [item.id, item.translation]));
      const usage = response.usage;

      return batch.map((unit) => {
        const translation = byId.get(unit.id);
        if (typeof translation !== "string") {
          return this.failedReviewResult(unit, model, `Missing revised translation for unit '${unit.id}'`);
        }

        return {
          id: unit.id,
          source: unit.source,
          translation,
          provider: this.name,
          model,
          status: "translated",
          metadata: usage ? { usage, reviewed: true } : { reviewed: true }
        };
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return batch.map((unit) => this.failedReviewResult(unit, model, message));
    }
  }

  async inferCharacters(
    candidates: CharacterCandidate[],
    options: CharacterInferenceOptions
  ): Promise<CharacterGlossary> {
    const model = options.model ?? DEFAULT_MODEL;
    if (candidates.length === 0) {
      return {};
    }

    if (!this.apiKey) {
      return Object.fromEntries(
        candidates.map((candidate) => [
          candidate.name,
          {
            translation: candidate.suggestedTranslation ?? candidate.name,
            gender: "unknown" as const,
            type: "unknown" as const,
            description: "DeepSeek inference skipped because DEEPSEEK_API_KEY is missing.",
            confidence: 0,
            review: true
          }
        ])
      );
    }

    const response = await this.requestChatCompletion(
      buildCharacterInferenceMessages(candidates, options),
      options,
      model,
      "disabled"
    );
    return parseCharactersPayload(response).characters;
  }

  private async requestChatCompletion(
    messages: ChatMessage[],
    options: TranslateOptions,
    model: string,
    thinkingMode: DeepSeekThinkingMode
  ): Promise<ChatCompletionResponse> {
    const url = `${this.baseUrl}/chat/completions`;
    const body = JSON.stringify({
      model,
      messages,
      thinking: { type: thinkingMode },
      response_format: { type: "json_object" },
      stream: false
    });

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000);

      try {
        const response = await this.fetchFn(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`
          },
          body,
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (!response.ok) {
          const error = new Error(`DeepSeek API error ${response.status}: ${response.statusText}`);
          if (attempt < this.maxRetries && isRetryableStatus(response.status)) {
            lastError = error;
            await sleep(this.retryDelayMs * (attempt + 1));
            continue;
          }
          throw error;
        }

        const json = await response.json();
        if (!isChatCompletionResponse(json)) {
          throw new Error("DeepSeek API returned an unexpected response shape");
        }
        return json;
      } catch (error: unknown) {
        clearTimeout(timeout);
        lastError = error;
        if (attempt < this.maxRetries && isRetryableError(error)) {
          await sleep(this.retryDelayMs * (attempt + 1));
          continue;
        }
        break;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private failedResult(unit: TranslationUnit, model: string, message: string): TranslationResult {
    return {
      id: unit.id,
      source: unit.source,
      translation: "",
      provider: this.name,
      model,
      status: "failed",
      issues: [providerIssue(unit.id, message)]
    };
  }

  private failedReviewResult(unit: ReviewUnit, model: string, message: string): TranslationResult {
    return {
      id: unit.id,
      source: unit.source,
      translation: unit.currentTranslation,
      provider: this.name,
      model,
      status: "failed",
      issues: [providerIssue(unit.id, message)],
      metadata: { reviewed: false }
    };
  }
}

function parseModelPayload(response: ChatCompletionResponse): ModelTranslationPayload {
  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("DeepSeek API response did not include message content");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error: unknown) {
    throw new Error(`DeepSeek API returned invalid JSON content: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error
    });
  }

  if (!isModelTranslationPayload(parsed)) {
    throw new Error("DeepSeek API JSON content did not match expected translations schema");
  }

  return parsed;
}

function parseCharactersPayload(response: ChatCompletionResponse): ModelCharactersPayload {
  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("DeepSeek API response did not include message content");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error: unknown) {
    throw new Error(`DeepSeek API returned invalid JSON content: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error
    });
  }

  if (!isModelCharactersPayload(parsed)) {
    throw new Error("DeepSeek API JSON content did not match expected characters schema");
  }

  return parsed;
}

function isChatCompletionResponse(value: unknown): value is ChatCompletionResponse {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<ChatCompletionResponse>;
  return Array.isArray(candidate.choices) && (candidate.usage == null || isProviderUsage(candidate.usage));
}

function isProviderUsage(value: unknown): value is ProviderUsage {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<ProviderUsage>;
  return (
    optionalNumber(candidate.prompt_tokens) &&
    optionalNumber(candidate.completion_tokens) &&
    optionalNumber(candidate.total_tokens) &&
    optionalUsageDetails(candidate.prompt_tokens_details) &&
    optionalUsageDetails(candidate.completion_tokens_details) &&
    optionalNumber(candidate.prompt_cache_hit_tokens) &&
    optionalNumber(candidate.prompt_cache_miss_tokens)
  );
}

function optionalUsageDetails(value: unknown): boolean {
  if (value == null) {
    return true;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as { cached_tokens?: unknown };
  return optionalNumber(candidate.cached_tokens);
}

function optionalNumber(value: unknown): boolean {
  return value == null || typeof value === "number";
}

function isModelTranslationPayload(value: unknown): value is ModelTranslationPayload {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<ModelTranslationPayload>;
  return (
    Array.isArray(candidate.translations) &&
    candidate.translations.every(
      (item) =>
        typeof item === "object" &&
        item != null &&
        !Array.isArray(item) &&
        typeof (item as { id?: unknown }).id === "string" &&
        typeof (item as { translation?: unknown }).translation === "string"
    )
  );
}

function isModelCharactersPayload(value: unknown): value is ModelCharactersPayload {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return false;
  }
  const characters = (value as { characters?: unknown }).characters;
  if (typeof characters !== "object" || characters == null || Array.isArray(characters)) {
    return false;
  }

  return Object.values(characters).every((entry) => {
    if (typeof entry !== "object" || entry == null || Array.isArray(entry)) {
      return false;
    }
    const candidate = entry as {
      gender?: unknown;
      type?: unknown;
      translation?: unknown;
      aliases?: unknown;
      description?: unknown;
      speechStyle?: unknown;
      confidence?: unknown;
      review?: unknown;
    };
    return (
      (candidate.gender == null || ["male", "female", "neutral", "unknown"].includes(String(candidate.gender))) &&
      (candidate.type == null || ["person", "place", "group", "creature", "object", "unknown"].includes(String(candidate.type))) &&
      (candidate.translation == null || typeof candidate.translation === "string") &&
      (candidate.description == null || typeof candidate.description === "string") &&
      (candidate.speechStyle == null || typeof candidate.speechStyle === "string") &&
      (candidate.confidence == null || typeof candidate.confidence === "number") &&
      (candidate.review == null || typeof candidate.review === "boolean") &&
      (candidate.aliases == null || (Array.isArray(candidate.aliases) && candidate.aliases.every((alias) => typeof alias === "string")))
    );
  });
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function isRetryableError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.message.includes("fetch failed"));
}

function providerIssue(id: string, message: string): ValidationIssue {
  return {
    id,
    severity: "error",
    code: "INVALID_JSON",
    message
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
