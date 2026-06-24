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

import { DEFAULT_RETRY_ATTEMPTS } from "../../core/retry/index.js";
import type { TranslateOptions } from "../../core/types.js";
import type { ChatMessage } from "../prompt-builder.js";
import {
  DEFAULT_BASE_URL,
  DEFAULT_MAX_TOKENS,
  DEFAULT_THINKING_MAX_TOKENS,
  DEFAULT_TEMPERATURE
} from "./defaults.js";
import { createHttpError, DeepSeekProviderError, isNetworkError, isTimeoutError } from "./errors.js";
import { isChatCompletionResponse } from "./schemas.js";
import type {
  ChatCompletionResponse,
  DeepSeekProviderConfig,
  DeepSeekResponse,
  DeepSeekThinkingMode,
  FetchLike
} from "./types.js";

// Cap any single backoff (including a server-provided Retry-After) so a large or
// malicious value cannot stall the run indefinitely.
const MAX_RETRY_DELAY_MS = 60_000;

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
    this.maxRetries = config.maxRetries ?? DEFAULT_RETRY_ATTEMPTS;
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
    // When thinking is enabled the chain-of-thought is billed against max_tokens,
    // so use a larger default; an explicit --max-tokens still takes precedence.
    const defaultMaxTokens = thinkingMode === "enabled" ? DEFAULT_THINKING_MAX_TOKENS : DEFAULT_MAX_TOKENS;
    const requestBody: Record<string, unknown> = {
      model,
      messages,
      thinking: { type: thinkingMode },
      max_tokens: options.maxTokens ?? defaultMaxTokens,
      response_format: { type: "json_object" },
      stream: false
    };
    // A reasoning pass (thinking enabled) ignores temperature on DeepSeek V4 and
    // rejects it with a non-retryable 400 on deepseek-reasoner, so only send it on
    // a non-thinking request where it actually has an effect.
    if (thinkingMode !== "enabled") {
      requestBody.temperature = options.temperature ?? DEFAULT_TEMPERATURE;
    }
    const body = JSON.stringify(requestBody);

    // The client is the single retry layer. Honor the caller's --retry-attempts
    // so the pipeline's retry setting controls real provider retries instead of
    // a redundant outer wrapper.
    const maxRetries = options.retryAttempts ?? this.maxRetries;
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
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
          if (attempt < maxRetries && isRetryableStatus(response.status)) {
            lastError = error;
            await sleep(backoffDelay(attempt, this.retryDelayMs, retryAfterMs(response)));
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
        if (attempt < maxRetries && isRetryableError(error)) {
          await sleep(backoffDelay(attempt, this.retryDelayMs));
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
  // Classify by AbortError (timeout) and by the underlying socket error code,
  // not by the error message string, so transient network failures retry.
  return isTimeoutError(error) || isNetworkError(error);
}

// Exponential backoff with equal jitter. A server-provided Retry-After (seconds
// or HTTP-date) takes precedence and is honored as-is, both capped to avoid an
// unbounded wait. Jitter spreads retries so concurrent batches do not stampede.
export function backoffDelay(attempt: number, baseMs: number, retryAfter?: number): number {
  if (retryAfter != null) {
    return Math.min(retryAfter, MAX_RETRY_DELAY_MS);
  }
  if (baseMs <= 0) {
    return 0;
  }
  const exponential = Math.min(baseMs * 2 ** attempt, MAX_RETRY_DELAY_MS);
  const half = exponential / 2;
  return Math.round(half + Math.random() * half);
}

export function retryAfterMs(response: DeepSeekResponse): number | undefined {
  const header = response.headers?.get("retry-after");
  if (!header) {
    return undefined;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return undefined;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
