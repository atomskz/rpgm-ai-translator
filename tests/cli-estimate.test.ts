import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli/app.js";
import { actorNameUnit, createCliTempDir, dialogueUnit, writeJsonFixture } from "./cli/helpers.js";

describe("CLI estimate", () => {
  it("reports batches, tokens and an optional USD band", async () => {
    const root = await createCliTempDir("rpgm-cli-estimate-");
    const unitsPath = path.join(root, "units.json");
    await writeJsonFixture(unitsPath, [actorNameUnit(), dialogueUnit()]);

    const stdout: string[] = [];
    const exitCode = await runCli(["estimate", unitsPath, "--batch-size", "1", "--price-per-1k", "0.5"], {
      stdout: (text) => stdout.push(text),
      stderr: () => undefined
    });

    const report = JSON.parse(stdout.join(""));
    expect(exitCode).toBe(0);
    expect(report).toMatchObject({ units: 2, batches: 2 });
    expect(report.estimatedTotalTokens).toBeGreaterThan(report.inputTokens);
    expect(report.estimatedUsdLow).toBeLessThan(report.estimatedUsdHigh);
  });

  it("omits the USD band without --price-per-1k", async () => {
    const root = await createCliTempDir("rpgm-cli-estimate-nousd-");
    const unitsPath = path.join(root, "units.json");
    await writeJsonFixture(unitsPath, [actorNameUnit()]);

    const stdout: string[] = [];
    await runCli(["estimate", unitsPath], { stdout: (text) => stdout.push(text), stderr: () => undefined });

    expect(JSON.parse(stdout.join(""))).not.toHaveProperty("estimatedUsdLow");
  });
});
