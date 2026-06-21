import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli/app.js";
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
});
