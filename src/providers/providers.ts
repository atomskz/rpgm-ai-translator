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

import type { LLMProvider } from "../core/ports/public-api.js";
import { DeepSeekProvider } from "./deepseek/public-api.js";
import { MockProvider } from "./mock.js";

// Provider-neutral configuration injected from the CLI. `baseUrl` lets the
// OpenAI-compatible DeepSeek client target a local or self-hosted endpoint, and
// `dialect` controls whether DeepSeek-proprietary request fields are sent.
export type ProviderConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  dialect?: "deepseek" | "openai";
};

// The single source of truth for which providers exist. Adding a provider is one
// entry here; the supported-name list, the ProviderName type and the help/preflight
// strings all derive from these keys so they can never drift out of lockstep.
const PROVIDERS: Record<string, (config: ProviderConfig) => LLMProvider> = {
  mock: () => new MockProvider(),
  deepseek: (config) => new DeepSeekProvider({ apiKey: config.apiKey, baseUrl: config.baseUrl, dialect: config.dialect })
};

// Stable, registration-order list of supported provider names, derived from the
// registry so a new provider appears everywhere it is listed automatically.
export const SUPPORTED_PROVIDER_NAMES = Object.keys(PROVIDERS);

export type ProviderName = keyof typeof PROVIDERS;

export function createProvider(name: string, config: ProviderConfig = {}): LLMProvider {
  const factory = PROVIDERS[name];
  if (!factory) {
    throw new Error(`Unknown provider '${name}'. Supported providers: ${SUPPORTED_PROVIDER_NAMES.join(", ")}`);
  }
  return factory(config);
}
