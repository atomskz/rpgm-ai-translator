import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli/app.js";
import { validateCommandArgs } from "../src/cli/options.js";

describe("validateCommandArgs", () => {
  it("suggests the closest option for a typo", () => {
    expect(() => validateCommandArgs("translate", ["units.json", "--taget", "ru"])).toThrow(
      "Unknown option --taget. Did you mean --target?"
    );
  });

  it("rejects an unknown option with no close match", () => {
    expect(() => validateCommandArgs("detect", ["./game", "--zzzzz"])).toThrow(
      "Unknown option --zzzzz for 'detect'"
    );
  });

  it("rejects an option that is missing its value", () => {
    expect(() => validateCommandArgs("translate", ["units.json", "--target"])).toThrow(
      "--target requires a value"
    );
  });

  it("treats the next flag as a missing value, not the value", () => {
    expect(() => validateCommandArgs("translate", ["units.json", "--provider", "--target", "ru"])).toThrow(
      "--provider requires a value"
    );
  });

  it("rejects an empty option value", () => {
    expect(() => validateCommandArgs("translate", ["units.json", "--target", ""])).toThrow(
      "--target requires a value"
    );
  });

  it("rejects a whitespace-only option value", () => {
    expect(() => validateCommandArgs("translate", ["units.json", "--out", "   "])).toThrow(
      "--out requires a value"
    );
  });

  it("rejects a duplicated value option", () => {
    expect(() => validateCommandArgs("translate", ["units.json", "--target", "ja", "--target", "ru"])).toThrow(
      "Option --target was provided more than once"
    );
  });

  it("accepts a valid set of options", () => {
    expect(() =>
      validateCommandArgs("run", [
        "./game",
        "--provider",
        "mock",
        "--target",
        "ru",
        "--out",
        "./out",
        "--include-plugins",
        "--review",
        "--repair"
      ])
    ).not.toThrow();
  });

  it("allows repeated boolean flags and ignores positionals and --help", () => {
    expect(() =>
      validateCommandArgs("extract", ["./game", "--include-plugins", "--include-plugins", "--help"])
    ).not.toThrow();
  });
});

describe("runCli option validation", () => {
  it("reports an unknown option through the CLI and exits non-zero", async () => {
    const errors: string[] = [];
    const exitCode = await runCli(["translate", "units.json", "--taget", "ru"], {
      stdout: () => undefined,
      stderr: (text) => errors.push(text)
    });

    expect(exitCode).toBe(1);
    expect(errors.join("")).toContain("Unknown option --taget. Did you mean --target?");
  });
});
