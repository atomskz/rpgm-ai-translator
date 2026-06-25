import { describe, expect, it } from "vitest";
import { collectRevalidatedBatch } from "../src/core/pipeline/public-api.js";
import type { TranslationResult } from "../src/core/types/public-api.js";

function result(id: string, overrides: Partial<TranslationResult> = {}): TranslationResult {
  return {
    id,
    source: id,
    translation: `t-${id}`,
    provider: "mock",
    model: "m",
    status: "translated",
    ...overrides
  };
}

describe("collectRevalidatedBatch", () => {
  it("accepts requested translated results and records them", () => {
    const acceptedById = new Map<string, TranslationResult>();
    const { checkpointResults, failed, anomalous } = collectRevalidatedBatch(
      [result("a"), result("b")],
      new Set(["a", "b"]),
      acceptedById,
      (r) => ({ ...r, translation: `kept-${r.id}` }),
      () => undefined
    );
    expect(failed).toBe(0);
    expect(anomalous).toBe(0);
    expect(acceptedById.get("a")?.translation).toBe("kept-a");
    expect(checkpointResults.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("drops a duplicate id and an unrequested id without double-counting", () => {
    const acceptedById = new Map<string, TranslationResult>();
    const { checkpointResults, failed, anomalous } = collectRevalidatedBatch(
      [result("a"), result("a"), result("z", { status: "failed" })],
      new Set(["a"]),
      acceptedById,
      (r) => r,
      () => undefined
    );
    // The second "a" (duplicate) and "z" (not requested) are dropped, not failed,
    // and never reach the checkpoint where they would replay on resume.
    expect(anomalous).toBe(2);
    expect(failed).toBe(0);
    expect(checkpointResults.map((r) => r.id)).toEqual(["a"]);
    expect(acceptedById.size).toBe(1);
  });

  it("records a regressed candidate as a failure with the kept-previous substitute", () => {
    const acceptedById = new Map<string, TranslationResult>();
    const previous = result("a", { translation: "previous" });
    const { checkpointResults, failed, anomalous } = collectRevalidatedBatch(
      [result("a")],
      new Set(["a"]),
      acceptedById,
      (r) => r,
      () => previous
    );
    expect(failed).toBe(1);
    expect(anomalous).toBe(0);
    expect(acceptedById.size).toBe(0);
    expect(checkpointResults).toEqual([previous]);
  });

  it("counts a requested id the provider omitted as a failure but does not checkpoint it", () => {
    const acceptedById = new Map<string, TranslationResult>();
    const { checkpointResults, failed, anomalous } = collectRevalidatedBatch(
      [result("a")],
      new Set(["a", "b"]),
      acceptedById,
      (r) => r,
      () => undefined
    );
    // "b" was requested but never returned: counted as a failure, kept out of the
    // checkpoint so a resume re-requests it; "a" is still accepted normally.
    expect(failed).toBe(1);
    expect(anomalous).toBe(0);
    expect(acceptedById.has("a")).toBe(true);
    expect(checkpointResults.map((r) => r.id)).toEqual(["a"]);
  });

  it("records a non-translated requested result as a failure", () => {
    const acceptedById = new Map<string, TranslationResult>();
    const { failed, anomalous } = collectRevalidatedBatch(
      [result("a", { status: "failed" })],
      new Set(["a"]),
      acceptedById,
      (r) => r,
      () => undefined
    );
    expect(failed).toBe(1);
    expect(anomalous).toBe(0);
  });
});
