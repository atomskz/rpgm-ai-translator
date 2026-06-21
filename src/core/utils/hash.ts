import { createHash } from "node:crypto";

export function hashSource(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

/**
 * Hashes an arbitrary value into a stable cache key. Object keys are sorted and
 * `undefined` members are dropped so that structurally equal inputs always map
 * to the same digest regardless of property insertion order.
 */
export function hashCacheKey(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}
