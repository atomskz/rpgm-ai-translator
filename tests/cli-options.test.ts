import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli/app.js";
import { validateCommandArgs } from "../src/cli/options/public-api.js";

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

  it("rejects a surplus positional and points characters at --translations", () => {
    expect(() => validateCommandArgs("characters", ["units.json", "translations.json"])).toThrow(
      "Unexpected argument 'translations.json' for 'characters'. characters reads only <units.json>; pass the translations file via --translations."
    );
  });

  it("rejects a surplus positional for a single-argument command", () => {
    expect(() => validateCommandArgs("translate", ["units.json", "extra.json"])).toThrow(
      "Unexpected argument 'extra.json' for 'translate'."
    );
  });

  it("accepts the documented positionals for a two-argument command", () => {
    expect(() => validateCommandArgs("review", ["units.json", "translations.json", "--out", "out.json"])).not.toThrow();
  });

  it("accepts repair's --codes and --attempts as aliases in run", () => {
    expect(() =>
      validateCommandArgs("run", ["./game", "--out", "./out", "--codes", "MISSING_TRANSLATION", "--attempts", "2"])
    ).not.toThrow();
  });

  it("treats an alias and its canonical flag as the same option", () => {
    expect(() =>
      validateCommandArgs("run", ["./game", "--out", "./out", "--codes", "MISSING_TRANSLATION", "--repair-codes", "EMPTY_TRANSLATION"])
    ).toThrow("Option --repair-codes was provided more than once");
  });
});

describe("runCli option validation", () => {
  it("accepts a global flag before the subcommand", async () => {
    const errors: string[] = [];
    const exitCode = await runCli(["--verbose", "detect", process.cwd()], {
      stdout: () => undefined,
      stderr: (text) => errors.push(text)
    });

    // The leading --verbose must not be mistaken for the command.
    expect(exitCode).toBe(0);
    expect(errors.join("")).not.toContain("Unknown command");
  });

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
