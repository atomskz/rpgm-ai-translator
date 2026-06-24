import { describe, expect, it } from "vitest";
import { normalizeBatchSize, splitBatch } from "../src/core/batching/index.js";

describe("normalizeBatchSize", () => {
  it("falls back on a missing, non-positive or non-finite size", () => {
    expect(normalizeBatchSize(undefined)).toBe(20);
    expect(normalizeBatchSize(0)).toBe(20);
    expect(normalizeBatchSize(-5)).toBe(20);
    expect(normalizeBatchSize(Number.NaN)).toBe(20);
    expect(normalizeBatchSize(Number.POSITIVE_INFINITY)).toBe(20);
  });

  it("floors a fractional size and honors a custom fallback", () => {
    expect(normalizeBatchSize(3.9)).toBe(3);
    expect(normalizeBatchSize(undefined, 5)).toBe(5);
  });
});

describe("splitBatch", () => {
  it("splits items into normalized-size chunks", () => {
    expect(splitBatch([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns no batches for an empty input", () => {
    expect(splitBatch([], 4)).toEqual([]);
  });

  it("uses the default size when given an invalid one", () => {
    expect(splitBatch([1, 2, 3], 0)).toEqual([[1, 2, 3]]);
  });
});
