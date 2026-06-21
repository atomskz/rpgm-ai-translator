import type { TranslateOptions } from "../../core/types.js";
import type { ChatMessage } from "../prompt-builder.js";
import {
  DEFAULT_BASE_URL,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE
} from "./defaults.js";
import { createHttpError, DeepSeekProviderError } from "./errors.js";
import { isChatCompletionResponse } from "./schemas.js";
import type {
  ChatCompletionResponse,
  DeepSeekProviderConfig,
  DeepSeekResponse,
  DeepSeekThinkingMode,
  FetchLike
} from "./types.js";

export class DeepSeekClient {
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

  get hasApiKey(): boolean {
    return Boolean(this.apiKey);
  }

  async requestChatCompletion(
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
      temperature: options.temperature ?? DEFAULT_TEMPERATURE,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
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
          const error = await createHttpError(response);
          if (attempt < this.maxRetries && isRetryableStatus(response.status)) {
            lastError = error;
            await sleep(this.retryDelayMs * (attempt + 1));
            continue;
          }
          throw error;
        }

        const json = await response.json();
        if (!isChatCompletionResponse(json)) {
          throw new DeepSeekProviderError(
            "DeepSeek API returned an unexpected response shape",
            "PROVIDER_RESPONSE_SCHEMA_ERROR"
          );
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
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function isRetryableError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.message.includes("fetch failed"));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
