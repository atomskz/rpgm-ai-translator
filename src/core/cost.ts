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

import { normalizeBatchSize } from "./batching.js";
import type { TokenUsage, TranslationResult, TranslationUnit } from "./types/public-api.js";

// Rough heuristics for a pre-flight estimate. Token counts vary by tokenizer and
// language, so this is intentionally approximate: ~4 characters per token plus a
// fixed prompt overhead per unit. It is meant to catch order-of-magnitude
// mistakes (and feed a budget guard), not to be billing-accurate.
const CHARS_PER_TOKEN = 4;
const OVERHEAD_TOKENS_PER_UNIT = 16;

// Per-request fixed cost: the system prompt, JSON-format instructions and the
// (capped) glossary sent with every batch. Approximate, but enough that the total
// estimate sits above a real run's input rather than a small fraction of it.
const SYSTEM_TOKENS_PER_BATCH = 500;

// The model echoes each unit's id and emits a translation that, across languages,
// runs on the order of the source length. Charge output as a multiple of the
// source-token count so the total estimate is comparable to the budget, which
// accumulates the provider's reported total (input + output) tokens.
const OUTPUT_TOKENS_PER_SOURCE_TOKEN = 1.5;

function sourceTokens(units: TranslationUnit[]): number {
  let characters = 0;
  for (const unit of units) {
    characters += (unit.normalizedSource ?? unit.source).length;
  }
  return Math.ceil(characters / CHARS_PER_TOKEN);
}

// Input-only estimate: the source text plus a per-unit prompt/id overhead. Used
// for the human-readable "input tokens" preview; the budget guard uses the total
// estimate below.
export function estimateInputTokens(units: TranslationUnit[]): number {
  return sourceTokens(units) + units.length * OVERHEAD_TOKENS_PER_UNIT;
}

// Estimate the total (input + output) tokens a translate-style pass will spend, so
// a --max-tokens-budget pre-flight is comparable to what the budget records.
// estimateInputTokens counted only source characters, undershooting the recorded
// total (which includes the per-batch system prompt and every output token) by a
// large multiplier — so the guard let an over-budget run pass pre-flight and then
// abort mid-run after spending. This folds in the per-batch system/glossary
// overhead and an output multiplier so the estimate lands within a sane factor of
// the real total.
export function estimateTotalTokens(units: TranslationUnit[], options: { batchSize?: number } = {}): number {
  if (units.length === 0) {
    return 0;
  }
  const batchCount = Math.ceil(units.length / normalizeBatchSize(options.batchSize));
  const input = estimateInputTokens(units) + batchCount * SYSTEM_TOKENS_PER_BATCH;
  const output = Math.ceil(sourceTokens(units) * OUTPUT_TOKENS_PER_SOURCE_TOKEN);
  return input + output;
}

// Sum the provider-neutral token usage recorded on translation results. Returns
// undefined when no result carries usage so callers can omit it from reports.
//
// A provider reports usage once per batch, but that single usage object is shared
// across every result in the batch (and copied onto duplicate-source siblings).
// Summing naively would multiply a batch's cost by its size, so each distinct
// usage object is counted once by identity.
export function aggregateTokenUsage(results: TranslationResult[]): TokenUsage | undefined {
  const total: Required<TokenUsage> = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0 };
  const counted = new Set<TokenUsage>();
  for (const result of results) {
    const usage = result.metadata?.tokenUsage;
    if (!usage || counted.has(usage)) {
      continue;
    }
    counted.add(usage);
    total.inputTokens += usage.inputTokens ?? 0;
    total.outputTokens += usage.outputTokens ?? 0;
    total.totalTokens += usage.totalTokens ?? 0;
    total.cachedInputTokens += usage.cachedInputTokens ?? 0;
  }
  return counted.size > 0 ? total : undefined;
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
        `Estimated ${estimatedTokens} tokens exceed the --max-tokens-budget of ${this.limit}. Raise the budget or reduce scope.`
      );
    }
  }

  // Pre-flight check that accounts for tokens already spent. A review or repair
  // pass runs after translate, so guard it against (spent + estimate) and fail
  // before the pass starts rather than mid-batch once the budget is blown.
  assertProjectedWithin(estimatedTokens: number): void {
    const projected = this.spent + estimatedTokens;
    if (projected > this.limit) {
      throw new Error(
        `Estimated ${projected} tokens (${this.spent} used + ${estimatedTokens} for the next pass) exceed the --max-tokens-budget of ${this.limit}. Raise the budget or reduce scope.`
      );
    }
  }
}
