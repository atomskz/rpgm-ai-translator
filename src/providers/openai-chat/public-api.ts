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

// Provider-neutral OpenAI-compatible chat-completion building blocks: the shared
// degradation base, the client contract, response/payload shapes, the response
// schema parsers, and the error type/helpers a dialect reuses.
export { OpenAiChatProvider } from "./base.js";
export { ChatCompletionProviderError, createHttpError, isNetworkError, isTimeoutError, networkErrorCode } from "./errors.js";
export { isChatCompletionResponse, parseCharactersPayload, parseTranslationsPayload } from "./schemas.js";
export type {
  ChatCompletionClient,
  ChatCompletionPass,
  ChatCompletionResponse,
  ModelCharactersPayload,
  ModelTranslationPayload
} from "./types.js";
