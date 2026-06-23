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

import type { TokenUsage, TranslationResult, TranslationUnit } from "../types.js";

// Rough heuristics for a pre-flight estimate. Token counts vary by tokenizer and
// language, so this is intentionally approximate: ~4 characters per token plus a
// fixed prompt overhead per unit. It is meant to catch order-of-magnitude
// mistakes (and feed a budget guard), not to be billing-accurate.
const CHARS_PER_TOKEN = 4;
const OVERHEAD_TOKENS_PER_UNIT = 16;

export function estimateInputTokens(units: TranslationUnit[]): number {
  let characters = 0;
  for (const unit of units) {
    characters += (unit.normalizedSource ?? unit.source).length;
  }
  return Math.ceil(characters / CHARS_PER_TOKEN) + units.length * OVERHEAD_TOKENS_PER_UNIT;
}

// Sum the provider-neutral token usage recorded on translation results. Returns
// undefined when no result carries usage so callers can omit it from reports.
export function aggregateTokenUsage(results: TranslationResult[]): TokenUsage | undefined {
  const total: Required<TokenUsage> = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0 };
  let found = false;
  for (const result of results) {
    const usage = result.metadata?.tokenUsage;
    if (!usage) {
      continue;
    }
    found = true;
    total.inputTokens += usage.inputTokens ?? 0;
    total.outputTokens += usage.outputTokens ?? 0;
    total.totalTokens += usage.totalTokens ?? 0;
    total.cachedInputTokens += usage.cachedInputTokens ?? 0;
  }
  return found ? total : undefined;
}

// Tracks tokens spent across batches and aborts when the limit is passed.
export class TokenBudget {
  private spent = 0;

  constructor(readonly limit: number) {}

  get spentTokens(): number {
    return this.spent;
  }

  record(results: TranslationResult[]): void {
    const usage = aggregateTokenUsage(results);
    if (usage) {
      this.spent += usage.totalTokens || (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
    }
  }

  assertWithin(): void {
    if (this.spent > this.limit) {
      throw new Error(
        `Token budget of ${this.limit} exceeded after using ${this.spent} tokens. Raise --max-tokens-budget or reduce scope.`
      );
    }
  }

  assertEstimateWithin(estimatedTokens: number): void {
    if (estimatedTokens > this.limit) {
      throw new Error(
        `Estimated ${estimatedTokens} input tokens exceed the --max-tokens-budget of ${this.limit}. Raise the budget or reduce scope.`
      );
    }
  }
}
