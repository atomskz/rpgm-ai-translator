import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli/app.js";
import { echoTargetLanguage, readTargetLanguage, validateCommandArgs } from "../src/cli/options/public-api.js";

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

  it("accepts characters' translations file as an optional second positional", () => {
    expect(() => validateCommandArgs("characters", ["units.json", "translations.json"])).not.toThrow();
  });

  it("rejects a third positional for characters", () => {
    expect(() => validateCommandArgs("characters", ["units.json", "translations.json", "extra.json"])).toThrow(
      "Unexpected argument 'extra.json' for 'characters'."
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

describe("readTargetLanguage", () => {
  it("reports an explicit --target as not defaulted", () => {
    expect(readTargetLanguage(["units.json", "--target", "en"])).toEqual({ value: "en", defaulted: false });
  });

  it("falls back to ru and marks it defaulted when --target is absent", () => {
    expect(readTargetLanguage(["units.json"])).toEqual({ value: "ru", defaulted: true });
  });
});

describe("echoTargetLanguage", () => {
  it("marks the default target and warns only when asked", () => {
    const lines: string[] = [];
    echoTargetLanguage(["units.json"], (text) => lines.push(text), { warnOnDefault: true });
    const out = lines.join("");
    expect(out).toContain("Target language: ru (default)");
    expect(out).toContain("no --target was given");
  });

  it("echoes an explicit target without the default marker or a warning", () => {
    const lines: string[] = [];
    echoTargetLanguage(["units.json", "--target", "en"], (text) => lines.push(text), { warnOnDefault: true });
    const out = lines.join("");
    expect(out).toContain("Target language: en");
    expect(out).not.toContain("(default)");
    expect(out).not.toContain("no --target was given");
  });
});

describe("runCli option validation", () => {
  it("accepts a global flag before the subcommand", async () => {
    // Detect a real game so the exit code reflects the global-flag handling, not an
    // unknown-engine non-zero exit.
    const game = await mkdtemp(path.join(tmpdir(), "rpgm-global-flag-"));
    await mkdir(path.join(game, "data"), { recursive: true });
    await mkdir(path.join(game, "js"), { recursive: true });
    await writeFile(path.join(game, "js", "rpg_core.js"), "", "utf8");
    await writeFile(path.join(game, "data", "System.json"), "{}", "utf8");

    const errors: string[] = [];
    const exitCode = await runCli(["--verbose", "detect", game], {
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
