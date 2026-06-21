const DEFAULT_BATCH_SIZE = 20;

export function normalizeBatchSize(batchSize: number | undefined, fallback = DEFAULT_BATCH_SIZE): number {
  if (batchSize == null || !Number.isFinite(batchSize) || batchSize < 1) {
    return fallback;
  }
  return Math.floor(batchSize);
}

export function splitBatch<T>(items: T[], batchSize: number): T[][] {
  const normalizedBatchSize = normalizeBatchSize(batchSize);
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += normalizedBatchSize) {
    batches.push(items.slice(index, index + normalizedBatchSize));
  }
  return batches;
}
