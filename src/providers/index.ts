import type { LLMProvider } from "../core/types.js";
import { DeepSeekProvider } from "./deepseek/index.js";
import { MockProvider } from "./mock/index.js";

export type ProviderName = "mock" | "deepseek";

export function createProvider(name: string): LLMProvider {
  if (name === "mock") {
    return new MockProvider();
  }

  if (name === "deepseek") {
    return new DeepSeekProvider();
  }

  throw new Error(`Unknown provider '${name}'. Supported providers: mock, deepseek`);
}
