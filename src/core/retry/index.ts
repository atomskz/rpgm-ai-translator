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

export type RetryEvent = {
  error: unknown;
  retryIndex: number;
  maxAttempts: number;
};

export type RetryOptions = {
  retryAttempts?: number;
  retryDelayMs?: number;
  onRetry?: (event: RetryEvent) => void | Promise<void>;
};

/**
 * Convenience wrapper that retries a provider call using the retry settings
 * carried on `TranslateOptions`/`ReviewOptions`. Shared by the translate, review,
 * repair and character-inference passes so transient provider failures are
 * retried consistently rather than only on the bulk translate path.
 */
export async function withProviderRetry<T>(
  operation: () => Promise<T>,
  options: { retryAttempts?: number; retryDelayMs?: number; onRetry?: RetryOptions["onRetry"] }
): Promise<T> {
  return withRetry(operation, {
    retryAttempts: options.retryAttempts,
    retryDelayMs: options.retryDelayMs,
    onRetry: options.onRetry
  });
}

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const retryAttempts = options.retryAttempts ?? 1;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retryAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error: unknown) {
      lastError = error;
      if (attempt < retryAttempts) {
        await options.onRetry?.({
          error,
          retryIndex: attempt + 1,
          maxAttempts: retryAttempts + 1
        });
        await sleep(options.retryDelayMs ?? 250);
      }
    }
  }

  throw lastError;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
