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

import type { CharacterGlossary, ProviderUsage } from "../../core/types/public-api.js";

export type FetchLike = (url: string, init: DeepSeekRequestInit) => Promise<DeepSeekResponse>;

export type DeepSeekRequestInit = {
  method: "POST";
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
};

export type DeepSeekResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
  // Present on real fetch responses (Headers); used to honor Retry-After.
  headers?: { get(name: string): string | null };
};

// "deepseek" sends DeepSeek's proprietary request fields (the `thinking` switch);
// "openai" sends only plain OpenAI-compatible Chat Completions fields, so a
// generic/local endpoint does not 400 on an unknown field.
export type DeepSeekDialect = "deepseek" | "openai";

export type DeepSeekProviderConfig = {
  apiKey?: string;
  baseUrl?: string;
  dialect?: DeepSeekDialect;
  fetchFn?: FetchLike;
  maxRetries?: number;
  retryDelayMs?: number;
};

export type DeepSeekThinkingMode = "enabled" | "disabled";

export type ChatCompletionResponse = {
  choices: Array<{
    message?: {
      content?: string | null;
    };
    // "length" means the model hit max_tokens; used to distinguish a truncated
    // response from a genuinely empty/malformed one.
    finish_reason?: string | null;
  }>;
  usage?: ProviderUsage;
};

export type ModelTranslationPayload = {
  translations: Array<{
    id: string;
    translation: string;
  }>;
};

export type ModelCharactersPayload = {
  characters: CharacterGlossary;
};
