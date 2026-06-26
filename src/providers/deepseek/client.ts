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

import { DEFAULT_RETRY_ATTEMPTS, sleep } from "../../core/retry.js";
import type { ThinkingPreference, TranslateOptions } from "../../core/types/public-api.js";
import {
  ChatCompletionProviderError,
  createHttpError,
  isChatCompletionResponse,
  isNetworkError,
  isTimeoutError
} from "../openai-chat/public-api.js";
import type { ChatCompletionClient, ChatCompletionPass, ChatCompletionResponse } from "../openai-chat/public-api.js";
import type { ChatMessage } from "../prompt-builder/public-api.js";
import {
  DEFAULT_BASE_URL,
  DEFAULT_MAX_TOKENS,
  DEFAULT_THINKING_MAX_TOKENS,
  DEFAULT_TEMPERATURE
} from "./defaults.js";
import type {
  DeepSeekDialect,
  DeepSeekProviderConfig,
  DeepSeekResponse,
  DeepSeekThinkingMode,
  FetchLike
} from "./types.js";

// The host label used in DeepSeek error messages.
const HOST = "DeepSeek";

// Cap any single backoff (including a server-provided Retry-After) so a large or
// malicious value cannot stall the run indefinitely.
const MAX_RETRY_DELAY_MS = 60_000;

export class DeepSeekClient implements ChatCompletionClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly dialect: DeepSeekDialect;
  private readonly fetchFn: FetchLike;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(config: DeepSeekProviderConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.DEEPSEEK_API_KEY;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    // Default to the DeepSeek dialect only when talking to DeepSeek itself; a
    // custom --base-url is assumed OpenAI-compatible (the documented use). An
    // explicit dialect always wins so a DeepSeek-behind-a-proxy setup still works.
    this.dialect = config.dialect ?? (this.baseUrl === DEFAULT_BASE_URL.replace(/\/$/, "") ? "deepseek" : "openai");
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
    pass: ChatCompletionPass
  ): Promise<ChatCompletionResponse> {
    const url = `${this.baseUrl}/chat/completions`;
    // Reasoning depends on the model's capability, not just the pass: a plain chat
    // model (deepseek-chat) does not reason, so forcing thinking on its review pass
    // wasted the 32k ceiling and dropped temperature. `--thinking on|off` overrides.
    const thinkingMode = thinkingModeFor(model, pass, options.thinking);
    // A DeepSeek reasoning pass (thinking enabled) bills chain-of-thought against
    // max_tokens, so it needs a larger default. The openai dialect has no thinking
    // mode, so it never inflates the budget regardless of the requested pass.
    const reasoning = this.dialect === "deepseek" && thinkingMode === "enabled";
    const defaultMaxTokens = reasoning ? DEFAULT_THINKING_MAX_TOKENS : DEFAULT_MAX_TOKENS;
    const requestBody: Record<string, unknown> = {
      model,
      messages,
      max_tokens: options.maxTokens ?? defaultMaxTokens,
      response_format: { type: "json_object" },
      stream: false
    };
    // `thinking` is a DeepSeek-proprietary field; sending it to a generic
    // OpenAI-compatible (or local) endpoint is a non-retryable 400, so only the
    // deepseek dialect includes it. This is what makes a custom --base-url work.
    if (this.dialect === "deepseek") {
      requestBody.thinking = { type: thinkingMode };
    }
    // A reasoning pass ignores temperature on DeepSeek V4 and is rejected by
    // deepseek-reasoner, so omit it only there; every other request — including
    // every openai-dialect request — sends it where it has an effect.
    if (!reasoning) {
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
          const error = await createHttpError(response, HOST);
          if (attempt < maxRetries && isRetryableStatus(response.status)) {
            lastError = error;
            await sleep(backoffDelay(attempt, this.retryDelayMs, retryAfterMs(response)));
            continue;
          }
          throw error;
        }

        const json = await response.json();
        if (!isChatCompletionResponse(json)) {
          throw new ChatCompletionProviderError(
            `${HOST} API returned an unexpected response shape`,
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

// Decide whether to reason on this request. An explicit --thinking on/off always
// wins; "auto" (the default) reasons only on the review pass and only when the
// model can reason, so a non-reasoning model keeps temperature and the plain token
// ceiling on review instead of paying the reasoning defaults for no benefit.
export function thinkingModeFor(
  model: string,
  pass: ChatCompletionPass,
  preference: ThinkingPreference | undefined
): DeepSeekThinkingMode {
  if (preference === "on") {
    return "enabled";
  }
  if (preference === "off") {
    return "disabled";
  }
  return pass === "review" && isReasoningCapableModel(model) ? "enabled" : "disabled";
}

// DeepSeek model families that reason — `deepseek-reasoner`, and the hybrid V4
// line (`deepseek-v4-*`, e.g. the default flash) and R1 — which can toggle the
// `thinking` switch. A plain chat model (`deepseek-chat`, V3) cannot, so "auto"
// leaves it off. An unrecognized model also defaults off; force it with
// `--thinking on` when a custom reasoning model is in use.
function isReasoningCapableModel(model: string): boolean {
  const name = model.toLowerCase();
  if (name.includes("chat")) {
    return false;
  }
  return name.includes("reasoner") || name.includes("v4") || name.includes("r1");
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
