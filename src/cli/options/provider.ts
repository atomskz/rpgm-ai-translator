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

import type { TranslateOptions } from "../../core/types/public-api.js";
import { SUPPORTED_PROVIDER_NAMES } from "../../providers/public-api.js";
import { readNonNegativeIntegerOption, readNumberOption, readOption, readPositiveIntegerOption } from "./readers.js";
import { UsageError } from "./usage-error.js";

export type ProviderCliOptions = Pick<
  TranslateOptions,
  "targetLanguage" | "model" | "batchSize" | "timeoutMs" | "temperature" | "maxTokens"
>;

export type TranslateCliOptions = ProviderCliOptions & Pick<TranslateOptions, "retryAttempts" | "concurrency">;

// Derived from the provider registry so the accepted CLI names track the shipped
// providers automatically (a new provider needs no edit here).
const SUPPORTED_PROVIDERS = SUPPORTED_PROVIDER_NAMES;

// Built-in target language used when neither --target nor a config "target" key is
// given. Kept as one constant so the echo (readTargetLanguage) and the option
// readers agree on what "defaulted" means.
export const DEFAULT_TARGET_LANGUAGE = "ru";

// Resolve the target language and whether it came from the user — a --target flag,
// or a config "target" that mergeConfigIntoArgs already injected as --target before
// the command runs — versus falling back to the built-in default.
export function readTargetLanguage(args: string[]): { value: string; defaulted: boolean } {
  const explicit = readOption(args, "--target");
  return { value: explicit ?? DEFAULT_TARGET_LANGUAGE, defaulted: explicit == null };
}

// Echo the resolved target on every translating command so a forgotten flag or a
// one-character typo is visible before any paid spend, not after playing the game.
// `warnOnDefault` (used by run) additionally warns when nothing supplied a target.
export function echoTargetLanguage(
  args: string[],
  stderr: (text: string) => void,
  options: { warnOnDefault?: boolean } = {}
): void {
  const { value, defaulted } = readTargetLanguage(args);
  stderr(`Target language: ${value}${defaulted ? " (default)" : ""}\n`);
  if (defaulted && options.warnOnDefault) {
    stderr(
      `Warning: no --target was given, so this run translates into '${value}' by default. ` +
        `Pass --target <language> or set "target" in rpgm-ai-translator.json to translate into another language.\n`
    );
  }
}

// Validate the provider name up front so an unknown value (or `none` on a command
// that does not support it) fails before any side effects such as writing a
// checkpoint, instead of throwing deep inside createProvider. `none` is only
// meaningful to the characters command, which handles it before calling this.
export function assertProviderReady(providerName: string): void {
  if (!(SUPPORTED_PROVIDERS as readonly string[]).includes(providerName)) {
    const hint =
      providerName === "none"
        ? " ('none' builds a heuristic glossary and is only valid for the characters command, like --draft-only)"
        : "";
    throw new UsageError(`Unknown provider '${providerName}'. Supported: ${SUPPORTED_PROVIDERS.join(", ")}${hint}.`);
  }
  if (providerName === "deepseek" && !process.env.DEEPSEEK_API_KEY?.trim()) {
    throw new Error("DEEPSEEK_API_KEY is required when using --provider deepseek");
  }
}

export function readProviderName(args: string[], defaultProvider = "mock"): string {
  return readOption(args, "--provider") ?? defaultProvider;
}

export function readProviderConfig(args: string[]): { baseUrl?: string; dialect?: "deepseek" | "openai" } {
  return { baseUrl: readOption(args, "--base-url"), dialect: readApiDialect(args) };
}

// Resolve --api-dialect. "auto" (the default) returns undefined so the provider
// picks the dialect from the base URL; an explicit value forces it. A custom
// --base-url is assumed OpenAI-compatible, so a local endpoint works without this.
function readApiDialect(args: string[]): "deepseek" | "openai" | undefined {
  const value = readOption(args, "--api-dialect");
  if (value == null || value === "auto") {
    return undefined;
  }
  if (value !== "deepseek" && value !== "openai") {
    throw new UsageError("--api-dialect must be one of: deepseek, openai, auto");
  }
  return value;
}

export function readProviderCliOptions(args: string[]): ProviderCliOptions {
  return {
    targetLanguage: readOption(args, "--target") ?? DEFAULT_TARGET_LANGUAGE,
    model: readOption(args, "--model"),
    batchSize: readPositiveIntegerOption(args, "--batch-size"),
    timeoutMs: readPositiveIntegerOption(args, "--timeout-ms"),
    temperature: readNumberOption(args, "--temperature", { min: 0, max: 2 }),
    maxTokens: readPositiveIntegerOption(args, "--max-tokens")
  };
}

export function readTranslateCliOptions(args: string[]): TranslateCliOptions {
  return {
    ...readProviderCliOptions(args),
    retryAttempts: readNonNegativeIntegerOption(args, "--retry-attempts"),
    concurrency: readPositiveIntegerOption(args, "--concurrency")
  };
}
