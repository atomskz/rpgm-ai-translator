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
import { readNonNegativeIntegerOption, readNumberOption, readOption, readPositiveIntegerOption } from "./readers.js";
import { UsageError } from "./usage-error.js";

export type ProviderCliOptions = Pick<
  TranslateOptions,
  "targetLanguage" | "model" | "batchSize" | "timeoutMs" | "temperature" | "maxTokens"
>;

export type TranslateCliOptions = ProviderCliOptions & Pick<TranslateOptions, "retryAttempts">;

const SUPPORTED_PROVIDERS = ["mock", "deepseek"] as const;

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

export function readProviderConfig(args: string[]): { baseUrl?: string } {
  return { baseUrl: readOption(args, "--base-url") };
}

export function readProviderCliOptions(args: string[]): ProviderCliOptions {
  return {
    targetLanguage: readOption(args, "--target") ?? "ru",
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
    retryAttempts: readNonNegativeIntegerOption(args, "--retry-attempts")
  };
}
