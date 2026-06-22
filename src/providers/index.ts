import type { LLMProvider } from "../core/types.js";
import { DeepSeekProvider } from "./deepseek/index.js";
import { MockProvider } from "./mock/index.js";

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
