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

  it("prints command-specific help for run --help", async () => {
    const output: string[] = [];
    const exitCode = await runCli(["run", "--help"], {
      stdout: (text) => output.push(text),
      stderr: () => undefined
    });
    const text = output.join("");

    expect(exitCode).toBe(0);
    expect(text).toContain("Usage: rpgm-ai-translator run <game> --out <dir>");
    expect(text).toContain("--review");
    expect(text).toContain("--font <value>");
    expect(text).toContain("--repair-attempts <value>");
    // run does not accept apply's --units flag.
    expect(text).not.toContain("--units");
  });

  it("notes the apply --font constraint in apply --help", async () => {
    const output: string[] = [];
    const exitCode = await runCli(["apply", "--help"], {
      stdout: (text) => output.push(text),
      stderr: () => undefined
    });
    const text = output.join("");

    expect(exitCode).toBe(0);
    expect(text).toContain("Usage: rpgm-ai-translator apply");
    expect(text).toContain("--font and --number-font apply only in --mode patch together with --out.");
  });
});
