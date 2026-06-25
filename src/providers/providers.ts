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

import type { LLMProvider } from "../core/types/types.js";
import { DeepSeekProvider } from "./deepseek/deepseek.js";
import { MockProvider } from "./mock.js";

export type ProviderName = "mock" | "deepseek";

// Provider-neutral configuration injected from the CLI. `baseUrl` lets the
// OpenAI-compatible DeepSeek client target a local or self-hosted endpoint.
export type ProviderConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

export function createProvider(name: string, config: ProviderConfig = {}): LLMProvider {
  if (name === "mock") {
    return new MockProvider();
  }

  if (name === "deepseek") {
    return new DeepSeekProvider({ apiKey: config.apiKey, baseUrl: config.baseUrl });
  }

  throw new Error(`Unknown provider '${name}'. Supported providers: mock, deepseek`);
}
