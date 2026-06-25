import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli/app.js";
import { acquireDirectoryLock } from "../src/core/locks.js";
import { actorNameUnit, createCliTempDir, translatedResult, writeJsonFixture } from "./cli/helpers.js";

describe("CLI apply and patch-font", () => {
  it("patches the MZ font settings into an existing patch directory", async () => {
    const root = await createCliTempDir("rpgm-cli-font-");
    const outDir = path.join(root, "out");
    const fontPath = path.join(root, "RusFont.ttf");
    await writeFile(fontPath, "fake-font", "utf8");
    await mkdir(path.join(root, "game", "data"), { recursive: true });
    await writeJsonFixture(path.join(root, "game", "data", "System.json"), {
      advanced: { mainFontFilename: "Old.woff", numberFontFilename: "OldBold.woff" }
    });

    const exitCode = await runCli(["patch-font", path.join(root, "game"), "--out", outDir, "--font", fontPath], {
      stdout: () => undefined,
      stderr: () => undefined
    });

    const patchedSystem = JSON.parse(await readFile(path.join(outDir, "data", "System.json"), "utf8"));
    expect(exitCode).toBe(0);
    expect(await readFile(path.join(outDir, "fonts", "RusFont.ttf"), "utf8")).toBe("fake-font");
    expect(patchedSystem.advanced.mainFontFilename).toBe("RusFont.ttf");
    expect(patchedSystem.advanced.numberFontFilename).toBe("RusFont.ttf");
  });

  it("patches an MV game by rewriting fonts/gamefont.css", async () => {
    const root = await createCliTempDir("rpgm-cli-font-mv-");
    const outDir = path.join(root, "out");
    const fontPath = path.join(root, "RusFont.ttf");
    await writeFile(fontPath, "fake-font", "utf8");
    await mkdir(path.join(root, "game", "data"), { recursive: true });
    await mkdir(path.join(root, "game", "js"), { recursive: true });
    await writeFile(path.join(root, "game", "js", "rpg_core.js"), "", "utf8");
    await writeJsonFixture(path.join(root, "game", "data", "System.json"), {});

    const exitCode = await runCli(["patch-font", path.join(root, "game"), "--out", outDir, "--font", fontPath], {
      stdout: () => undefined,
      stderr: () => undefined
    });

    expect(exitCode).toBe(0);
    expect(await readFile(path.join(outDir, "fonts", "RusFont.ttf"), "utf8")).toBe("fake-font");
    const css = await readFile(path.join(outDir, "fonts", "gamefont.css"), "utf8");
    expect(css).toContain("font-family: GameFont");
    expect(css).toContain('url("RusFont.ttf")');
    // MV has no System.json.advanced font mechanism, so it is left untouched.
    await expect(access(path.join(outDir, "data", "System.json"))).rejects.toThrow();
  });

  it("locates and patches System.json under a www/ layout", async () => {
    const root = await createCliTempDir("rpgm-cli-font-www-");
    const outDir = path.join(root, "out");
    const fontPath = path.join(root, "RusFont.ttf");
    await writeFile(fontPath, "fake-font", "utf8");
    await mkdir(path.join(root, "game", "www", "data"), { recursive: true });
    await mkdir(path.join(root, "game", "www", "js"), { recursive: true });
    await writeFile(path.join(root, "game", "www", "js", "rmmz_core.js"), "", "utf8");
    await writeJsonFixture(path.join(root, "game", "www", "data", "System.json"), { advanced: {} });

    const exitCode = await runCli(["patch-font", path.join(root, "game"), "--out", outDir, "--font", fontPath], {
      stdout: () => undefined,
      stderr: () => undefined
    });

    expect(exitCode).toBe(0);
    const patchedSystem = JSON.parse(await readFile(path.join(outDir, "www", "data", "System.json"), "utf8"));
    expect(patchedSystem.advanced.mainFontFilename).toBe("RusFont.ttf");
    expect(await readFile(path.join(outDir, "www", "fonts", "RusFont.ttf"), "utf8")).toBe("fake-font");
  });

  it("refuses to font-patch an unrecognized project", async () => {
    const root = await createCliTempDir("rpgm-cli-font-unknown-");
    const outDir = path.join(root, "out");
    const fontPath = path.join(root, "RusFont.ttf");
    await writeFile(fontPath, "fake-font", "utf8");
    await mkdir(path.join(root, "game"), { recursive: true });

    const errors: string[] = [];
    const exitCode = await runCli(["patch-font", path.join(root, "game"), "--out", outDir, "--font", fontPath], {
      stdout: () => undefined,
      stderr: (text) => errors.push(text)
    });

    expect(exitCode).not.toBe(0);
    expect(errors.join("")).toContain("not a recognized RPG Maker");
  });

  it("applies translations using an explicit units file", async () => {
    const root = await createCliTempDir("rpgm-cli-apply-units-");
    const gamePath = path.join(root, "game");
    const outDir = path.join(root, "patch");
    const unitsPath = path.join(root, "units.json");
    const translationsPath = path.join(root, "translations.json");
    await mkdir(path.join(gamePath, "data"), { recursive: true });
    await writeJsonFixture(path.join(gamePath, "data", "Actors.json"), [null, { name: "Aria" }]);
    await writeJsonFixture(unitsPath, [actorNameUnit({ normalizedSource: undefined, hash: "hash-aria" })]);
    await writeJsonFixture(translationsPath, [translatedResult()]);

    const exitCode = await runCli(
      ["apply", gamePath, translationsPath, "--mode", "patch", "--units", unitsPath, "--out", outDir],
      {
        stdout: () => undefined,
        stderr: () => undefined
      }
    );

    const patchedActors = JSON.parse(await readFile(path.join(outDir, "data", "Actors.json"), "utf8"));
    const sourceActors = JSON.parse(await readFile(path.join(gamePath, "data", "Actors.json"), "utf8"));
    expect(exitCode).toBe(0);
    expect(patchedActors[1].name).toBe("Ария");
    expect(sourceActors[1].name).toBe("Aria");
  });

  it("refuses a non-empty patch --out without --force, then overwrites with it", async () => {
    const root = await createCliTempDir("rpgm-cli-apply-force-");
    const gamePath = path.join(root, "game");
    const outDir = path.join(root, "patch");
    const unitsPath = path.join(root, "units.json");
    const translationsPath = path.join(root, "translations.json");
    await mkdir(path.join(gamePath, "data"), { recursive: true });
    await writeJsonFixture(path.join(gamePath, "data", "Actors.json"), [null, { name: "Aria" }]);
    await writeJsonFixture(unitsPath, [actorNameUnit({ normalizedSource: undefined, hash: "hash-aria" })]);
    await writeJsonFixture(translationsPath, [translatedResult()]);

    const baseArgs = ["apply", gamePath, translationsPath, "--mode", "patch", "--units", unitsPath, "--out", outDir];
    // First apply into a fresh directory succeeds.
    expect(await runCli(baseArgs, { stdout: () => undefined, stderr: () => undefined })).toBe(0);

    // Re-applying into the now-populated directory is refused so two patches are
    // not silently overlaid on each other.
    const errors: string[] = [];
    const refused = await runCli(baseArgs, { stdout: () => undefined, stderr: (text) => errors.push(text) });
    expect(refused).toBe(1);
    expect(errors.join("")).toContain("not empty");
    expect(errors.join("")).toContain("--force");

    // With --force it proceeds.
    expect(await runCli([...baseArgs, "--force"], { stdout: () => undefined, stderr: () => undefined })).toBe(0);
  });

  it("refuses to apply while the output directory is locked", async () => {
    const root = await createCliTempDir("rpgm-cli-apply-lock-");
    const gamePath = path.join(root, "game");
    const outDir = path.join(root, "patch");
    const unitsPath = path.join(root, "units.json");
    const translationsPath = path.join(root, "translations.json");
    await mkdir(path.join(gamePath, "data"), { recursive: true });
    await writeJsonFixture(path.join(gamePath, "data", "Actors.json"), [null, { name: "Aria" }]);
    await writeJsonFixture(unitsPath, [actorNameUnit({ normalizedSource: undefined, hash: "hash-aria" })]);
    await writeJsonFixture(translationsPath, [translatedResult()]);

    // Hold the out-dir lock under this (live) process, so apply cannot acquire it.
    const lock = await acquireDirectoryLock(outDir);
    try {
      const errors: string[] = [];
      const exitCode = await runCli(
        ["apply", gamePath, translationsPath, "--mode", "patch", "--units", unitsPath, "--out", outDir],
        { stdout: () => undefined, stderr: (text) => errors.push(text) }
      );
      expect(exitCode).toBe(1);
      expect(errors.join("")).toContain("Another run is using");
    } finally {
      await lock.release();
    }
  });

  it("rejects an invalid --mode value", async () => {
    const errors: string[] = [];
    const exitCode = await runCli(
      ["apply", "./game", "./translations.json", "--mode", "banana", "--out", "./out"],
      {
        stdout: () => undefined,
        stderr: (text) => errors.push(text)
      }
    );

    expect(exitCode).toBe(1);
    expect(errors.join("")).toContain("--mode must be one of patch, in-place");
  });

  it("rejects apply in patch mode without --out as a usage error", async () => {
    const errors: string[] = [];
    const exitCode = await runCli(["apply", "./game", "./translations.json"], {
      stdout: () => undefined,
      stderr: (text) => errors.push(text)
    });

    expect(exitCode).toBe(1);
    const text = errors.join("");
    expect(text).toContain("patch mode requires --out");
    expect(text).toContain("Usage: rpgm-ai-translator apply");
  });

  it("warns when most translations are skipped without --units", async () => {
    const root = await createCliTempDir("rpgm-cli-apply-mismatch-");
    const gamePath = path.join(root, "game");
    const outDir = path.join(root, "patch");
    const translationsPath = path.join(root, "translations.json");
    await mkdir(path.join(gamePath, "data"), { recursive: true });
    await writeJsonFixture(path.join(gamePath, "data", "System.json"), {});
    await writeJsonFixture(path.join(gamePath, "data", "Actors.json"), [null, { name: "Aria" }]);
    await writeJsonFixture(translationsPath, [
      translatedResult({ id: "Unknown.1.name", source: "Ghost", translation: "Призрак" })
    ]);

    const errors: string[] = [];
    const exitCode = await runCli(["apply", gamePath, translationsPath, "--out", outDir], {
      stdout: () => undefined,
      stderr: (text) => errors.push(text)
    });

    // Every translation was skipped (a full id mismatch), so apply must report a
    // non-zero exit instead of a clean success on an almost-empty patch.
    expect(exitCode).toBe(1);
    expect(errors.join("")).toContain("did not match the re-extracted units");
    expect(errors.join("")).toContain("--units");
  });

  it("warns even when only some translations are skipped without --units", async () => {
    const root = await createCliTempDir("rpgm-cli-apply-partial-");
    const gamePath = path.join(root, "game");
    const outDir = path.join(root, "patch");
    const translationsPath = path.join(root, "translations.json");
    await mkdir(path.join(gamePath, "data"), { recursive: true });
    await writeJsonFixture(path.join(gamePath, "data", "System.json"), {});
    await writeJsonFixture(path.join(gamePath, "data", "Actors.json"), [null, { name: "Aria" }, { name: "Borin" }]);
    await writeJsonFixture(translationsPath, [
      translatedResult({ id: "Actors.1.name", source: "Aria", translation: "Ария" }),
      translatedResult({ id: "Actors.2.name", source: "Borin", translation: "Борин" }),
      translatedResult({ id: "Unknown.1.name", source: "Ghost", translation: "Призрак" })
    ]);

    const errors: string[] = [];
    const output: string[] = [];
    const exitCode = await runCli(["apply", gamePath, translationsPath, "--out", outDir], {
      stdout: (text) => output.push(text),
      stderr: (text) => errors.push(text)
    });

    // Only one of three is skipped (<50%), which the old threshold left silent.
    expect(exitCode).toBe(0);
    expect(errors.join("")).toContain("skipped 1/3 translation(s)");
    expect(errors.join("")).toContain("Applied 2 translation(s)");
  });

  it("does not warn or fail when skips are unproduced translations, not id mismatches", async () => {
    const root = await createCliTempDir("rpgm-cli-apply-untranslated-");
    const gamePath = path.join(root, "game");
    const outDir = path.join(root, "patch");
    const translationsPath = path.join(root, "translations.json");
    await mkdir(path.join(gamePath, "data"), { recursive: true });
    await writeJsonFixture(path.join(gamePath, "data", "System.json"), {});
    await writeJsonFixture(path.join(gamePath, "data", "Actors.json"), [null, { name: "Aria" }, { name: "Borin" }]);
    // Both ids match the game, but two of three were never produced (failed/empty),
    // so the majority of skips are untranslated — not an id mismatch.
    await writeJsonFixture(translationsPath, [
      translatedResult({ id: "Actors.1.name", source: "Aria", translation: "Ария" }),
      translatedResult({ id: "Actors.2.name", source: "Borin", translation: "", status: "failed" })
    ]);

    const errors: string[] = [];
    const exitCode = await runCli(["apply", gamePath, translationsPath, "--out", outDir], {
      stdout: () => undefined,
      stderr: (text) => errors.push(text)
    });

    expect(exitCode).toBe(0);
    expect(errors.join("")).not.toContain("did not match the re-extracted units");
    expect(errors.join("")).toContain("Applied 1 translation(s)");
  });

  it("previews an apply with --dry-run without writing any files", async () => {
    const root = await createCliTempDir("rpgm-cli-apply-dry-");
    const gamePath = path.join(root, "game");
    const outDir = path.join(root, "patch");
    const unitsPath = path.join(root, "units.json");
    const translationsPath = path.join(root, "translations.json");
    await mkdir(path.join(gamePath, "data"), { recursive: true });
    await writeJsonFixture(path.join(gamePath, "data", "Actors.json"), [null, { name: "Aria" }]);
    await writeJsonFixture(unitsPath, [actorNameUnit({ normalizedSource: undefined, hash: "hash-aria" })]);
    await writeJsonFixture(translationsPath, [translatedResult()]);

    const output: string[] = [];
    const exitCode = await runCli(
      ["apply", gamePath, translationsPath, "--mode", "patch", "--units", unitsPath, "--out", outDir, "--dry-run"],
      {
        stdout: (text) => output.push(text),
        stderr: (text) => output.push(text)
      }
    );

    expect(exitCode).toBe(0);
    expect(output.join("")).toContain("[dry run] Would write 1 file(s), apply 1 unit(s), skip 0");
    await expect(access(outDir)).rejects.toThrow();
  });
});
