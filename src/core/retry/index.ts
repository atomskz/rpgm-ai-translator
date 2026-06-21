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
