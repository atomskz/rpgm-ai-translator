import type { CharacterGlossary, ProviderUsage } from "../../core/types.js";

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

export type DeepSeekProviderConfig = {
  apiKey?: string;
  baseUrl?: string;
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
