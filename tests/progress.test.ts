import { describe, expect, it } from "vitest";
import { createProgressLogger } from "../src/cli/progress.js";
import { summarizeBatchFailures } from "../src/core/reports/public-api.js";
import type { CliIO } from "../src/cli/types.js";
import type { TranslationResult } from "../src/core/types/types.js";

function failed(id: string, code: string, message: string): TranslationResult {
  return {
    id,
    source: id,
    translation: "",
    provider: "deepseek",
    model: "m",
    status: "failed",
    issues: [{ id, severity: "error", code: code as never, message }]
  };
}

function translated(id: string): TranslationResult {
  return { id, source: id, translation: "x", provider: "deepseek", model: "m", status: "translated" };
}

function capture(): { io: CliIO; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { stdout: (t) => out.push(t), stderr: (t) => err.push(t) }, out, err };
}

describe("summarizeBatchFailures", () => {
  it("groups failed results by code, counts them, and ignores succeeded units", () => {
    const summary = summarizeBatchFailures([
      failed("a", "PROVIDER_NETWORK_ERROR", "fetch failed"),
      failed("b", "PROVIDER_NETWORK_ERROR", "fetch failed again"),
      failed("c", "PROVIDER_AUTH_ERROR", "invalid key"),
      translated("d")
    ]);
    expect(summary).toEqual([
      { code: "PROVIDER_NETWORK_ERROR", message: "fetch failed", count: 2 },
      { code: "PROVIDER_AUTH_ERROR", message: "invalid key", count: 1 }
    ]);
  });

  it("records an UNKNOWN reason for a failed unit with no issues", () => {
    const summary = summarizeBatchFailures([
      { id: "a", source: "a", translation: "", provider: "p", model: "m", status: "failed" }
    ]);
    expect(summary).toHaveLength(1);
    expect(summary[0].code).toBe("UNKNOWN");
  });
});

describe("createProgressLogger", () => {
  it("prints the failure reasons under a batch line when units failed", () => {
    const { io, err } = capture();
    const log = createProgressLogger(io);
    log({
      type: "batch-complete",
      batchIndex: 1,
      batchCount: 1,
      batchSize: 2,
      translated: 0,
      failed: 2,
      completed: 2,
      total: 2,
      failures: [{ code: "PROVIDER_NETWORK_ERROR", message: "fetch failed", count: 2 }]
    });
    const text = err.join("");
    expect(text).toContain("translated 0, failed 2");
    expect(text).toContain("PROVIDER_NETWORK_ERROR (2): fetch failed");
  });

  it("does not print reasons when nothing failed", () => {
    const { io, err } = capture();
    const log = createProgressLogger(io);
    log({
      type: "batch-complete",
      batchIndex: 1,
      batchCount: 1,
      batchSize: 2,
      translated: 2,
      failed: 0,
      completed: 2,
      total: 2,
      failures: []
    });
    const text = err.join("");
    expect(text).toContain("translated 2, failed 0");
    expect(text).not.toContain(" - ");
  });
});
