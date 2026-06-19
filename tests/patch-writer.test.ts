import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { RpgMakerMvMzExtractor } from "../src/core/extractors";
import type { TranslationResult } from "../src/core/types";

describe("patch writer", () => {
  it("writes translated JSON to a patch directory without changing source files", async () => {
    const root = path.join(tmpdir(), `rpgm-patch-${Date.now()}`);
    const outDir = path.join(tmpdir(), `rpgm-patch-out-${Date.now()}`);
    await mkdir(path.join(root, "data"), { recursive: true });
    await mkdir(path.join(root, "js"), { recursive: true });
    await writeFile(path.join(root, "js", "rpg_core.js"), "", "utf8");
    await writeJson(path.join(root, "data", "Items.json"), [
      null,
      { id: 1, name: "Potion", description: String.raw`Restores \V[1] HP.` }
    ]);

    const extractor = new RpgMakerMvMzExtractor();
    const units = await extractor.extract(root);
    const description = units.find((unit) => unit.id === "Items.1.description");
    expect(description).toBeDefined();

    const translations: TranslationResult[] = [
      {
        id: "Items.1.description",
        source: description?.source ?? "",
        translation: "Восстанавливает <PH_1> ОЗ.",
        provider: "mock",
        model: "mock",
        status: "translated"
      }
    ];

    const result = await extractor.applyTranslations(root, translations, { mode: "patch", outDir });

    expect(result.unitsApplied).toBe(1);
    expect(await readFile(path.join(root, "data", "Items.json"), "utf8")).toContain("Restores");
    const patched = JSON.parse(await readFile(path.join(outDir, "data", "Items.json"), "utf8"));
    expect(patched[1].description).toBe(String.raw`Восстанавливает \V[1] ОЗ.`);
  });

  it("applies manually imported minimal translation JSON through the CLI", async () => {
    const root = path.join(tmpdir(), `rpgm-patch-cli-${Date.now()}`);
    const outDir = path.join(tmpdir(), `rpgm-patch-cli-out-${Date.now()}`);
    const translationsPath = path.join(tmpdir(), `rpgm-translations-${Date.now()}.json`);
    await mkdir(path.join(root, "data"), { recursive: true });
    await mkdir(path.join(root, "js"), { recursive: true });
    await writeFile(path.join(root, "js", "rpg_core.js"), "", "utf8");
    await writeJson(path.join(root, "data", "Actors.json"), [null, { id: 1, name: "Aria" }]);
    await writeJson(translationsPath, [{ id: "Actors.1.name", source: "Aria", translation: "Ария" }]);

    const { runCli } = await import("../src/cli/app.js");
    const exitCode = await runCli(["apply", root, translationsPath, "--mode", "patch", "--out", outDir], {
      stdout: () => undefined,
      stderr: () => undefined
    });

    const patched = JSON.parse(await readFile(path.join(outDir, "data", "Actors.json"), "utf8"));
    expect(exitCode).toBe(0);
    expect(patched[1].name).toBe("Ария");
  });

  it("can filter validation-error translations through a report in the CLI", async () => {
    const root = path.join(tmpdir(), `rpgm-patch-report-cli-${Date.now()}`);
    const outDir = path.join(tmpdir(), `rpgm-patch-report-cli-out-${Date.now()}`);
    const translationsPath = path.join(tmpdir(), `rpgm-translations-report-${Date.now()}.json`);
    const reportPath = path.join(tmpdir(), `rpgm-report-${Date.now()}.json`);
    await mkdir(path.join(root, "data"), { recursive: true });
    await mkdir(path.join(root, "js"), { recursive: true });
    await writeFile(path.join(root, "js", "rpg_core.js"), "", "utf8");
    await writeJson(path.join(root, "data", "Actors.json"), [
      null,
      { id: 1, name: "Aria", profile: String.raw`Hello \N[1].` }
    ]);
    await writeJson(translationsPath, [
      { id: "Actors.1.name", source: "Aria", translation: "Ария" },
      { id: "Actors.1.profile", source: String.raw`Hello \N[1].`, translation: "Привет без кода." }
    ]);
    await writeJson(reportPath, {
      engine: "rpgmaker-mv",
      filesScanned: 1,
      unitsExtracted: 2,
      unitsTranslated: 2,
      fromMemory: 0,
      failed: 0,
      validationIssues: [
        {
          id: "Actors.1.profile",
          severity: "error",
          code: "MISSING_PLACEHOLDER",
          message: "Missing placeholder <PH_1>"
        }
      ]
    });

    const { runCli } = await import("../src/cli/app.js");
    const output: string[] = [];
    const exitCode = await runCli(["apply", root, translationsPath, "--mode", "patch", "--out", outDir, "--report", reportPath], {
      stdout: (text) => output.push(text),
      stderr: () => undefined
    });

    const patched = JSON.parse(await readFile(path.join(outDir, "data", "Actors.json"), "utf8"));
    expect(exitCode).toBe(0);
    expect(output.join("")).toContain("1/2 validation-safe translations");
    expect(patched[1].name).toBe("Ария");
    expect(patched[1].profile).toBe(String.raw`Hello \N[1].`);
  });

  it("writes translated string literals from control variable commands", async () => {
    const root = path.join(tmpdir(), `rpgm-quest-patch-${Date.now()}`);
    const outDir = path.join(tmpdir(), `rpgm-quest-patch-out-${Date.now()}`);
    await mkdir(path.join(root, "data"), { recursive: true });
    await mkdir(path.join(root, "js"), { recursive: true });
    await writeFile(path.join(root, "js", "rmmz_core.js"), "", "utf8");
    await writeJson(path.join(root, "data", "Map001.json"), {
      events: [
        null,
        {
          id: 1,
          name: "Quest Event",
          pages: [
            {
              list: [{ code: 122, parameters: [1, 1, 0, 4, JSON.stringify("Find the lost ring.")] }]
            }
          ]
        }
      ]
    });

    const extractor = new RpgMakerMvMzExtractor();
    const units = await extractor.extract(root);
    const questUnit = units.find((unit) => unit.id === "Map001.events.1.pages.0.list.0.parameters.4");
    expect(questUnit).toMatchObject({
      source: "Find the lost ring.",
      constraints: { sourceEncoding: "json-string-literal" }
    });

    const result = await extractor.applyTranslations(
      root,
      [
        {
          id: questUnit?.id ?? "",
          source: "Find the lost ring.",
          translation: "Найти потерянное кольцо.",
          provider: "manual",
          model: "manual",
          status: "translated"
        }
      ],
      { mode: "patch", outDir }
    );

    const patched = JSON.parse(await readFile(path.join(outDir, "data", "Map001.json"), "utf8"));
    expect(result.unitsApplied).toBe(1);
    expect(patched.events[1].pages[0].list[0].parameters[4]).toBe(JSON.stringify("Найти потерянное кольцо."));
    expect(await readFile(path.join(root, "data", "Map001.json"), "utf8")).toContain("Find the lost ring.");
  });

  it("writes in-place only after creating a backup", async () => {
    const root = path.join(tmpdir(), `rpgm-in-place-${Date.now()}`);
    const backupDir = path.join(tmpdir(), `rpgm-in-place-backup-${Date.now()}`);
    await mkdir(path.join(root, "data"), { recursive: true });
    await mkdir(path.join(root, "js"), { recursive: true });
    await writeFile(path.join(root, "js", "rpg_core.js"), "", "utf8");
    await writeJson(path.join(root, "data", "Actors.json"), [null, { id: 1, name: "Aria" }]);

    const extractor = new RpgMakerMvMzExtractor();
    const result = await extractor.applyTranslations(
      root,
      [
        {
          id: "Actors.1.name",
          source: "Aria",
          translation: "Ария",
          provider: "manual",
          model: "manual",
          status: "translated"
        }
      ],
      { mode: "in-place", backupDir }
    );

    const changed = JSON.parse(await readFile(path.join(root, "data", "Actors.json"), "utf8"));
    const backup = JSON.parse(await readFile(path.join(backupDir, "data", "Actors.json"), "utf8"));
    expect(result).toMatchObject({
      mode: "in-place",
      unitsApplied: 1,
      backupDir
    });
    expect(changed[1].name).toBe("Ария");
    expect(backup[1].name).toBe("Aria");
  });

  it("writes translated plugin parameters to plugins.js when plugin extraction is enabled", async () => {
    const root = path.join(tmpdir(), `rpgm-plugin-patch-${Date.now()}`);
    const outDir = path.join(tmpdir(), `rpgm-plugin-patch-out-${Date.now()}`);
    await mkdir(path.join(root, "data"), { recursive: true });
    await mkdir(path.join(root, "js"), { recursive: true });
    await writeFile(path.join(root, "js", "rmmz_core.js"), "", "utf8");
    await writeFile(
      path.join(root, "js", "plugins.js"),
      `var $plugins = ${JSON.stringify([
        {
          name: "AutoHeal",
          status: true,
          parameters: {
            AutoHealName: "Auto Recover",
            AutoHealSymbol: "autoheal"
          }
        }
      ])};\n`,
      "utf8"
    );

    const extractor = new RpgMakerMvMzExtractor();
    const units = await extractor.extract(root, { includePlugins: true });
    const pluginUnit = units.find((unit) => unit.id === "plugins.0.parameters.AutoHealName");
    expect(pluginUnit).toBeDefined();

    const result = await extractor.applyTranslations(
      root,
      [
        {
          id: pluginUnit?.id ?? "",
          source: "Auto Recover",
          translation: "Автолечение",
          provider: "manual",
          model: "manual",
          status: "translated"
        }
      ],
      { mode: "patch", outDir, includePlugins: true }
    );

    const patchedRaw = await readFile(path.join(outDir, "js", "plugins.js"), "utf8");
    expect(result.unitsApplied).toBe(1);
    expect(await readFile(path.join(root, "js", "plugins.js"), "utf8")).toContain("Auto Recover");
    expect(patchedRaw).toContain("Автолечение");
    expect(patchedRaw).toContain("autoheal");
  });
});

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
