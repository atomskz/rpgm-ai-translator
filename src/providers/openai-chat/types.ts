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

import type { CharacterGlossary, ProviderUsage, TranslateOptions } from "../../core/types/public-api.js";
import type { ChatMessage } from "../prompt-builder/public-api.js";

// Which pipeline pass a request serves. A concrete dialect maps this to its own
// request shaping (e.g. DeepSeek's reasoning `thinking` switch) without the
// provider-neutral base ever needing to know the dialect.
export type ChatCompletionPass = "translate" | "review" | "characters";

// The minimal client contract the shared OpenAI-chat base depends on: a key check
// and a single chat-completion request. A concrete provider supplies the request
// shaping (which fields its dialect sends, retries, base URL) behind this
// interface, so the base owns only the provider-neutral degradation skeleton.
export interface ChatCompletionClient {
  readonly hasApiKey: boolean;
  requestChatCompletion(
    messages: ChatMessage[],
    options: TranslateOptions,
    model: string,
    pass: ChatCompletionPass
  ): Promise<ChatCompletionResponse>;
}

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
