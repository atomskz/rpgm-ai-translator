export const DEFAULT_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_MODEL = "deepseek-v4-flash";
export const DEFAULT_TEMPERATURE = 0.3;
export const DEFAULT_MAX_TOKENS = 8192;
// Reasoning passes (thinking enabled) spend max_tokens on chain-of-thought
// before any answer token, so the answer needs a far larger ceiling than a
// plain completion. Used as the default for review/repair when --max-tokens is
// not set; an explicit --max-tokens always wins.
export const DEFAULT_THINKING_MAX_TOKENS = 32000;
