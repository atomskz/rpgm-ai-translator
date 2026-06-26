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

import { OpenAiChatProvider } from "../openai-chat/public-api.js";
import type { ChatCompletionClient } from "../openai-chat/public-api.js";
import { DeepSeekClient } from "./client.js";
import { DEFAULT_MODEL } from "./defaults.js";
import type { DeepSeekProviderConfig } from "./types.js";

// DeepSeek is the OpenAI-chat base wired to a DeepSeek-dialect client. All of the
// translate/review/character degradation logic lives in OpenAiChatProvider; this
// adapter only supplies the request shaping (the client) and the labels.
export class DeepSeekProvider extends OpenAiChatProvider {
  readonly name = "deepseek";

  protected readonly client: ChatCompletionClient;
  protected readonly defaultModel = DEFAULT_MODEL;
  protected readonly apiKeyName = "DEEPSEEK_API_KEY";

  constructor(config: DeepSeekProviderConfig = {}) {
    super();
    this.client = new DeepSeekClient(config);
  }
}

export type { DeepSeekProviderConfig } from "./types.js";
