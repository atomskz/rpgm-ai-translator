import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli/app.js";

describe("CLI help", () => {
  it("prints help for --help", async () => {
    const output: string[] = [];
    const errors: string[] = [];

    const exitCode = await runCli(["--help"], {
      stdout: (text) => output.push(text),
      stderr: (text) => errors.push(text)
    });

    expect(exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(output.join("")).toContain("Usage:");
    expect(output.join("")).toContain("Commands:");
    expect(output.join("")).toContain("translate <units.json>");
    expect(output.join("")).toContain("Translation options:");
    expect(output.join("")).toContain("--checkpoint <file>");
    expect(output.join("")).toContain("--attempts <n>");
    expect(output.join("")).toContain("--units <file>");
    expect(output.join("")).toContain("Environment:");
  });
});
