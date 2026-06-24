import { chmod, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { RpgMakerMvMzExtractor } from "../src/core/extractors";
import { writePatch } from "../src/core/patch-writer/index";
import { parsePluginsJs, replacePluginsArray } from "../src/core/plugins/index";
import type { TranslationResult, TranslationUnit } from "../src/core/types";

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

  it("changes only the translated leaf and preserves the rest of the document", async () => {
    const root = path.join(tmpdir(), `rpgm-patch-roundtrip-${Date.now()}`);
    const outDir = path.join(tmpdir(), `rpgm-patch-roundtrip-out-${Date.now()}`);
    await mkdir(path.join(root, "data"), { recursive: true });
    await mkdir(path.join(root, "js"), { recursive: true });
    await writeFile(path.join(root, "js", "rpg_core.js"), "", "utf8");
    // A document with a null hole, numbers, an empty string, nested objects and
    // arrays, plus untranslated siblings — everything but one leaf must survive.
    const original = [
      null,
      {
        id: 1,
        name: "Potion",
        description: "Restores HP.",
        price: 50,
        note: "",
        effects: [{ code: 11, dataId: 0, value1: 100, value2: 0 }],
        meta: { rare: false, tags: ["heal", "common"] }
      },
      { id: 2, name: "Ether", description: "Restores MP.", price: 120 }
    ];
    await writeJson(path.join(root, "data", "Items.json"), original);

    const extractor = new RpgMakerMvMzExtractor();
    const units = await extractor.extract(root);
    const target = units.find((u) => u.id === "Items.1.description");
    expect(target).toBeDefined();

    await extractor.applyTranslations(
      root,
      [
        {
          id: "Items.1.description",
          source: target?.source ?? "",
          translation: "Восстанавливает ОЗ.",
          provider: "mock",
          model: "mock",
          status: "translated"
        }
      ],
      { mode: "patch", outDir }
    );

    const patched = JSON.parse(await readFile(path.join(outDir, "data", "Items.json"), "utf8"));
    // Deep-equal the whole document against the original with only the one leaf
    // changed: any dropped field, reordered array or coerced number would fail here.
    const expected = JSON.parse(JSON.stringify(original));
    expected[1].description = "Восстанавливает ОЗ.";
    expect(patched).toEqual(expected);
  });

  it("rejects a unit file path that escapes the project root", async () => {
    const root = path.join(tmpdir(), `rpgm-patch-traversal-${Date.now()}`);
    const outDir = path.join(tmpdir(), `rpgm-patch-traversal-out-${Date.now()}`);
    await mkdir(path.join(root, "data"), { recursive: true });

    const translation = (id: string): TranslationResult => ({
      id,
      source: "Aria",
      translation: "Ария",
      provider: "manual",
      model: "manual",
      status: "translated"
    });
    const maliciousUnit = (filePath: string): TranslationUnit => ({
      id: "evil",
      source: "Aria",
      filePath,
      jsonPath: "0.name",
      engine: "rpgmaker-mv",
      category: "name",
      hash: "hash-evil"
    });

    await expect(
      writePatch(root, [maliciousUnit("../escape.json")], [translation("evil")], { mode: "patch", outDir })
    ).rejects.toThrow(/Unsafe unit file path/);
    await expect(
      writePatch(root, [maliciousUnit(path.join(tmpdir(), "abs-escape.json"))], [translation("evil")], {
        mode: "patch",
        outDir
      })
    ).rejects.toThrow(/Unsafe unit file path/);
  });

  it("preserves unrelated files already present in the patch directory", async () => {
    const root = path.join(tmpdir(), `rpgm-patch-preserve-${Date.now()}`);
    const outDir = path.join(tmpdir(), `rpgm-patch-preserve-out-${Date.now()}`);
    await mkdir(path.join(root, "data"), { recursive: true });
    await mkdir(path.join(root, "js"), { recursive: true });
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(root, "js", "rpg_core.js"), "", "utf8");
    await writeFile(path.join(outDir, "units.json"), "[]\n", "utf8");
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
      { mode: "patch", outDir }
    );

    const patched = JSON.parse(await readFile(path.join(outDir, "data", "Actors.json"), "utf8"));
    expect(result.unitsApplied).toBe(1);
    expect(patched[1].name).toBe("Ария");
    expect(await readFile(path.join(outDir, "units.json"), "utf8")).toBe("[]\n");
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
      stderr: (text) => output.push(text)
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

  it("writes translated JSON-encoded plugin command text inside map events", async () => {
    const root = path.join(tmpdir(), `rpgm-encoded-command-patch-${Date.now()}`);
    const outDir = path.join(tmpdir(), `rpgm-encoded-command-patch-out-${Date.now()}`);
    await mkdir(path.join(root, "data"), { recursive: true });
    await mkdir(path.join(root, "js"), { recursive: true });
    await writeFile(path.join(root, "js", "rmmz_core.js"), "", "utf8");
    await writeJson(path.join(root, "data", "Map001.json"), {
      events: [
        null,
        {
          id: 1,
          name: "Choice Event",
          pages: [
            {
              list: [
                {
                  code: 357,
                  parameters: [
                    "ChoicePlugin",
                    "showChoice",
                    "",
                    {
                      choices: JSON.stringify([
                        { label: "Give the ring?", value: "give_ring" },
                        { label: "Keep it", value: "keep_ring" }
                      ])
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    });

    const extractor = new RpgMakerMvMzExtractor();
    const units = await extractor.extract(root);
    const choiceUnit = units.find((unit) => unit.id === "Map001.events.1.pages.0.list.0.parameters.3.choices.$json.#0.label");
    expect(choiceUnit).toMatchObject({
      source: "Give the ring?",
      constraints: { sourceEncoding: "json-stringified-json", encodedJsonPath: "#0.label" }
    });

    const result = await extractor.applyTranslations(
      root,
      [
        {
          id: choiceUnit?.id ?? "",
          source: "Give the ring?",
          translation: "Отдать кольцо?",
          provider: "manual",
          model: "manual",
          status: "translated"
        }
      ],
      { mode: "patch", outDir }
    );

    const patched = JSON.parse(await readFile(path.join(outDir, "data", "Map001.json"), "utf8"));
    const encodedChoices = patched.events[1].pages[0].list[0].parameters[3].choices;
    expect(result.unitsApplied).toBe(1);
    expect(JSON.parse(encodedChoices)).toEqual([
      { label: "Отдать кольцо?", value: "give_ring" },
      { label: "Keep it", value: "keep_ring" }
    ]);
  });

  it("round-trips empty keys and distinguishes a numeric object key from an array index", async () => {
    const root = path.join(tmpdir(), `rpgm-encoded-keys-${Date.now()}`);
    const outDir = path.join(tmpdir(), `rpgm-encoded-keys-out-${Date.now()}`);
    await mkdir(path.join(root, "data"), { recursive: true });
    await mkdir(path.join(root, "js"), { recursive: true });
    await writeFile(path.join(root, "js", "rmmz_core.js"), "", "utf8");
    await writeJson(path.join(root, "data", "Map001.json"), {
      events: [
        null,
        {
          id: 1,
          name: "Keys Event",
          pages: [
            {
              list: [
                {
                  code: 357,
                  parameters: [
                    "KeysPlugin",
                    "show",
                    "",
                    {
                      choices: JSON.stringify({
                        "0": { text: "ObjZero" },
                        "": { text: "EmptyKey" },
                        items: [{ text: "ArrZero" }]
                      })
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    });

    const extractor = new RpgMakerMvMzExtractor();
    const units = await extractor.extract(root);
    const base = "Map001.events.1.pages.0.list.0.parameters.3.choices.$json";
    const objKeyUnit = units.find((unit) => unit.source === "ObjZero");
    const emptyKeyUnit = units.find((unit) => unit.source === "EmptyKey");
    const arrayUnit = units.find((unit) => unit.source === "ArrZero");

    // A numeric object key and an array index no longer collapse to the same id.
    expect(objKeyUnit?.id).toBe(`${base}.0.text`);
    expect(arrayUnit?.id).toBe(`${base}.items.#0.text`);
    expect(objKeyUnit?.id).not.toBe(arrayUnit?.id);
    // An empty key keeps its (empty) segment rather than collapsing the path.
    expect(emptyKeyUnit?.id).toBe(`${base}..text`);

    const result = await extractor.applyTranslations(
      root,
      [objKeyUnit, emptyKeyUnit, arrayUnit].map((unit) => ({
        id: unit?.id ?? "",
        source: unit?.source ?? "",
        translation: `[${unit?.source}]`,
        provider: "manual",
        model: "manual",
        status: "translated" as const
      })),
      { mode: "patch", outDir }
    );

    const patched = JSON.parse(await readFile(path.join(outDir, "data", "Map001.json"), "utf8"));
    const encoded = JSON.parse(patched.events[1].pages[0].list[0].parameters[3].choices);
    expect(result.unitsApplied).toBe(3);
    expect(encoded["0"].text).toBe("[ObjZero]");
    expect(encoded[""].text).toBe("[EmptyKey]");
    expect(encoded.items[0].text).toBe("[ArrZero]");
  });

  it("reports the reason a source file is skipped instead of silently counting it", async () => {
    const root = path.join(tmpdir(), `rpgm-skip-warn-${Date.now()}`);
    const outDir = path.join(tmpdir(), `rpgm-skip-warn-out-${Date.now()}`);
    await mkdir(path.join(root, "js"), { recursive: true });
    await writeFile(path.join(root, "js", "plugins.js"), "var notPlugins = 1;\n", "utf8");
    const unit: TranslationUnit = {
      id: "plugins.0.parameters.title",
      source: "Old",
      filePath: "js/plugins.js",
      jsonPath: "0.parameters.title",
      engine: "rpgmaker-mz",
      category: "plugin-parameter",
      hash: "h"
    };
    const warnings: string[] = [];

    const result = await writePatch(
      root,
      [unit],
      [{ id: unit.id, source: "Old", translation: "Новый", provider: "m", model: "m", status: "translated" }],
      { mode: "patch", outDir, onWarning: (message) => warnings.push(message) }
    );

    expect(result.skipped).toBe(1);
    expect(warnings.join("")).toContain("js/plugins.js");
    expect(warnings.join("")).toContain("$plugins");
  });

  it("applies a json-string-literal stored in a non-canonical form", async () => {
    const root = path.join(tmpdir(), `rpgm-jsl-${Date.now()}`);
    const outDir = path.join(tmpdir(), `rpgm-jsl-out-${Date.now()}`);
    await mkdir(path.join(root, "data"), { recursive: true });
    // The stored literal is valid but non-canonical (escaped solidus); a byte-for-byte
    // comparison with JSON.stringify(source) would skip it.
    await writeJson(path.join(root, "data", "Common.json"), { script: '"Visit \\/home"' });
    const unit: TranslationUnit = {
      id: "Common.script",
      source: "Visit /home",
      filePath: "data/Common.json",
      jsonPath: "script",
      engine: "rpgmaker-mz",
      category: "system",
      hash: "h",
      constraints: { sourceEncoding: "json-string-literal" }
    };

    const result = await writePatch(
      root,
      [unit],
      [{ id: unit.id, source: "Visit /home", translation: "Домой", provider: "m", model: "m", status: "translated" }],
      { mode: "patch", outDir }
    );

    const patched = JSON.parse(await readFile(path.join(outDir, "data", "Common.json"), "utf8"));
    expect(result.unitsApplied).toBe(1);
    expect(patched.script).toBe(JSON.stringify("Домой"));
  });

  it("skips a unit file that resolves outside the project via a symlink", async () => {
    const root = path.join(tmpdir(), `rpgm-symlink-${Date.now()}`);
    const outside = path.join(tmpdir(), `rpgm-symlink-outside-${Date.now()}.json`);
    const outDir = path.join(tmpdir(), `rpgm-symlink-out-${Date.now()}`);
    await mkdir(path.join(root, "data"), { recursive: true });
    await writeFile(outside, JSON.stringify({ name: "secret" }), "utf8");
    await symlink(outside, path.join(root, "data", "Actors.json"));
    const unit: TranslationUnit = {
      id: "Actors.1.name",
      source: "secret",
      filePath: "data/Actors.json",
      jsonPath: "name",
      engine: "rpgmaker-mz",
      category: "name",
      hash: "h"
    };
    const warnings: string[] = [];

    const result = await writePatch(
      root,
      [unit],
      [{ id: unit.id, source: "secret", translation: "x", provider: "m", model: "m", status: "translated" }],
      { mode: "patch", outDir, onWarning: (message) => warnings.push(message) }
    );

    expect(result.unitsApplied).toBe(0);
    expect(result.skipped).toBe(1);
    expect(warnings.join("")).toContain("symlink");
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

  it("rejects an in-place backup directory that overlaps the game data folder", async () => {
    const root = path.join(tmpdir(), `rpgm-in-place-badbackup-${Date.now()}`);
    await mkdir(path.join(root, "data"), { recursive: true });
    await mkdir(path.join(root, "js"), { recursive: true });
    await writeFile(path.join(root, "js", "rpg_core.js"), "", "utf8");
    await writeJson(path.join(root, "data", "Actors.json"), [null, { id: 1, name: "Aria" }]);

    const extractor = new RpgMakerMvMzExtractor();
    await expect(
      extractor.applyTranslations(
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
        { mode: "in-place", backupDir: path.join(root, "data", "backup") }
      )
    ).rejects.toThrow(/Backup directory must be outside the game folder/);

    // The guard runs before any write, so the game file is untouched.
    const unchanged = JSON.parse(await readFile(path.join(root, "data", "Actors.json"), "utf8"));
    expect(unchanged[1].name).toBe("Aria");
  });

  it("rejects an in-place backup directory inside the game root but outside data/js", async () => {
    const root = path.join(tmpdir(), `rpgm-in-place-rootbackup-${Date.now()}`);
    await mkdir(path.join(root, "data"), { recursive: true });
    await mkdir(path.join(root, "js"), { recursive: true });
    await mkdir(path.join(root, "img"), { recursive: true });
    await writeFile(path.join(root, "js", "rpg_core.js"), "", "utf8");
    await writeJson(path.join(root, "data", "Actors.json"), [null, { id: 1, name: "Aria" }]);

    const extractor = new RpgMakerMvMzExtractor();
    await expect(
      extractor.applyTranslations(
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
        { mode: "in-place", backupDir: path.join(root, "img") }
      )
    ).rejects.toThrow(/Backup directory must be outside the game folder/);
  });

  it("rolls back in-place files when a later write fails", async () => {
    const root = path.join(tmpdir(), `rpgm-in-place-rollback-${Date.now()}`);
    const backupDir = path.join(tmpdir(), `rpgm-in-place-rollback-backup-${Date.now()}`);
    const jsDir = path.join(root, "js");
    await mkdir(path.join(root, "data"), { recursive: true });
    await mkdir(jsDir, { recursive: true });
    await writeFile(path.join(jsDir, "rmmz_core.js"), "", "utf8");
    await writeJson(path.join(root, "data", "Actors.json"), [null, { id: 1, name: "Aria" }]);
    await writeFile(
      path.join(jsDir, "plugins.js"),
      `var $plugins = ${JSON.stringify([
        {
          name: "MenuText",
          status: true,
          parameters: {
            Label: "Quest Log"
          }
        }
      ])};\n`,
      "utf8"
    );

    const extractor = new RpgMakerMvMzExtractor();
    const translations: TranslationResult[] = [
      {
        id: "Actors.1.name",
        source: "Aria",
        translation: "Ария",
        provider: "manual",
        model: "manual",
        status: "translated"
      },
      {
        id: "plugins.0.parameters.Label",
        source: "Quest Log",
        translation: "Журнал заданий",
        provider: "manual",
        model: "manual",
        status: "translated"
      }
    ];

    await chmod(jsDir, 0o555);
    try {
      await expect(
        extractor.applyTranslations(root, translations, {
          mode: "in-place",
          backupDir,
          includePlugins: true
        })
      ).rejects.toThrow();
    } finally {
      await chmod(jsDir, 0o755);
    }

    const actors = JSON.parse(await readFile(path.join(root, "data", "Actors.json"), "utf8"));
    const backupActors = JSON.parse(await readFile(path.join(backupDir, "data", "Actors.json"), "utf8"));
    expect(actors[1].name).toBe("Aria");
    expect(backupActors[1].name).toBe("Aria");
    expect(await readFile(path.join(jsDir, "plugins.js"), "utf8")).toContain("Quest Log");
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

  it("skips an unparseable plugins.js and still applies data translations", async () => {
    const root = path.join(tmpdir(), `rpgm-patch-bad-plugins-${Date.now()}`);
    const outDir = path.join(tmpdir(), `rpgm-patch-bad-plugins-out-${Date.now()}`);
    await mkdir(path.join(root, "data"), { recursive: true });
    await mkdir(path.join(root, "js"), { recursive: true });
    await writeJson(path.join(root, "data", "Actors.json"), [null, { id: 1, name: "Aria" }]);
    await writeFile(path.join(root, "js", "plugins.js"), "this is not a valid plugins file", "utf8");

    const units: TranslationUnit[] = [
      { id: "Actors.1.name", source: "Aria", normalizedSource: "Aria", filePath: "data/Actors.json", jsonPath: "1.name", engine: "rpgmaker-mz", category: "name", hash: "h1" },
      { id: "plugins.0.parameters.Label", source: "Quest Log", normalizedSource: "Quest Log", filePath: "js/plugins.js", jsonPath: "0.parameters.Label", engine: "rpgmaker-mz", category: "plugin-parameter", hash: "h2" }
    ];
    const translations: TranslationResult[] = [
      { id: "Actors.1.name", source: "Aria", translation: "Ария", provider: "manual", model: "manual", status: "translated" },
      { id: "plugins.0.parameters.Label", source: "Quest Log", translation: "Журнал", provider: "manual", model: "manual", status: "translated" }
    ];

    const result = await writePatch(root, units, translations, { mode: "patch", outDir });

    const patched = JSON.parse(await readFile(path.join(outDir, "data", "Actors.json"), "utf8"));
    expect(result.unitsApplied).toBe(1);
    expect(result.skipped).toBe(1);
    expect(patched[1].name).toBe("Ария");
  });

  it("keeps a minified data file minified and changes only the translated string", async () => {
    const root = path.join(tmpdir(), `rpgm-minified-${Date.now()}`);
    const outDir = path.join(tmpdir(), `rpgm-minified-out-${Date.now()}`);
    await mkdir(path.join(root, "data"), { recursive: true });
    await mkdir(path.join(root, "js"), { recursive: true });
    await writeFile(path.join(root, "js", "rmmz_core.js"), "", "utf8");
    // Minified, single line, no trailing newline — as RPG Maker ships data files.
    await writeFile(path.join(root, "data", "Actors.json"), JSON.stringify([null, { id: 1, name: "Aria" }]), "utf8");

    const extractor = new RpgMakerMvMzExtractor();
    const result = await extractor.applyTranslations(
      root,
      [{ id: "Actors.1.name", source: "Aria", translation: "Ария", provider: "manual", model: "manual", status: "translated" }],
      { mode: "patch", outDir }
    );

    const patched = await readFile(path.join(outDir, "data", "Actors.json"), "utf8");
    expect(result.unitsApplied).toBe(1);
    expect(patched).toBe(JSON.stringify([null, { id: 1, name: "Ария" }]));
  });

  it("preserves the plugins.js header when patching", async () => {
    const root = path.join(tmpdir(), `rpgm-plugins-header-${Date.now()}`);
    const outDir = path.join(tmpdir(), `rpgm-plugins-header-out-${Date.now()}`);
    await mkdir(path.join(root, "data"), { recursive: true });
    await mkdir(path.join(root, "js"), { recursive: true });
    await writeFile(path.join(root, "js", "rmmz_core.js"), "", "utf8");
    const header = "// Generated by RPG Maker.\n// Do not edit this file directly.\n\n";
    await writeFile(
      path.join(root, "js", "plugins.js"),
      `${header}var $plugins =\n${JSON.stringify([{ name: "MenuPlugin", status: true, parameters: { CommandName: "Auto Recover" } }], null, 2)};\n`,
      "utf8"
    );

    const extractor = new RpgMakerMvMzExtractor();
    const result = await extractor.applyTranslations(
      root,
      [{ id: "plugins.0.parameters.CommandName", source: "Auto Recover", translation: "Автолечение", provider: "manual", model: "manual", status: "translated" }],
      { mode: "patch", outDir, includePlugins: true }
    );

    const patched = await readFile(path.join(outDir, "js", "plugins.js"), "utf8");
    expect(result.unitsApplied).toBe(1);
    expect(patched.startsWith(header)).toBe(true);
    expect(patched).toContain("Автолечение");
    expect(patched).not.toContain("Auto Recover");
  });

  it("refuses to patch when the output directory is the game folder", async () => {
    const root = path.join(tmpdir(), `rpgm-patch-same-${Date.now()}`);
    await mkdir(path.join(root, "data"), { recursive: true });
    await mkdir(path.join(root, "js"), { recursive: true });
    await writeFile(path.join(root, "js", "rmmz_core.js"), "", "utf8");
    await writeJson(path.join(root, "data", "Actors.json"), [null, { id: 1, name: "Aria" }]);

    const extractor = new RpgMakerMvMzExtractor();
    await expect(
      extractor.applyTranslations(
        root,
        [{ id: "Actors.1.name", source: "Aria", translation: "Ария", provider: "manual", model: "manual", status: "translated" }],
        { mode: "patch", outDir: root }
      )
    ).rejects.toThrow(/outside the game folder/);

    expect(await readFile(path.join(root, "data", "Actors.json"), "utf8")).toContain("Aria");
  });

  it("refuses to patch when the output directory is nested in the game folder", async () => {
    const root = path.join(tmpdir(), `rpgm-patch-nested-${Date.now()}`);
    await mkdir(path.join(root, "data"), { recursive: true });
    await mkdir(path.join(root, "js"), { recursive: true });
    await writeFile(path.join(root, "js", "rmmz_core.js"), "", "utf8");
    await writeJson(path.join(root, "data", "Actors.json"), [null, { id: 1, name: "Aria" }]);

    const extractor = new RpgMakerMvMzExtractor();
    await expect(
      extractor.applyTranslations(
        root,
        [{ id: "Actors.1.name", source: "Aria", translation: "Ария", provider: "manual", model: "manual", status: "translated" }],
        { mode: "patch", outDir: path.join(root, "translated") }
      )
    ).rejects.toThrow(/outside the game folder/);
  });

  it("writes translated JSON-encoded plugin parameters to plugins.js", async () => {
    const root = path.join(tmpdir(), `rpgm-plugin-json-patch-${Date.now()}`);
    const outDir = path.join(tmpdir(), `rpgm-plugin-json-patch-out-${Date.now()}`);
    await mkdir(path.join(root, "data"), { recursive: true });
    await mkdir(path.join(root, "js"), { recursive: true });
    await writeFile(path.join(root, "js", "rmmz_core.js"), "", "utf8");
    await writeFile(
      path.join(root, "js", "plugins.js"),
      `var $plugins = ${JSON.stringify([
        {
          name: "ChoicePlugin",
          status: true,
          parameters: {
            Choices: JSON.stringify([{ label: "Quest Log", symbol: "quest" }])
          }
        }
      ])};\n`,
      "utf8"
    );

    const extractor = new RpgMakerMvMzExtractor();
    const units = await extractor.extract(root, { includePlugins: true });
    const choiceUnit = units.find((unit) => unit.id === "plugins.0.parameters.Choices.$json.#0.label");
    expect(choiceUnit).toMatchObject({
      source: "Quest Log",
      constraints: { sourceEncoding: "json-stringified-json", encodedJsonPath: "#0.label" }
    });

    const result = await extractor.applyTranslations(
      root,
      [
        {
          id: choiceUnit?.id ?? "",
          source: "Quest Log",
          translation: "Журнал заданий",
          provider: "manual",
          model: "manual",
          status: "translated"
        }
      ],
      { mode: "patch", outDir, includePlugins: true }
    );

    const patchedRaw = await readFile(path.join(outDir, "js", "plugins.js"), "utf8");
    expect(result.unitsApplied).toBe(1);
    expect(patchedRaw).toContain("Журнал заданий");
    expect(patchedRaw).toContain("quest");
  });

  it("keeps distinct ids for sibling encoded-JSON paths that would dot-collide", async () => {
    const root = path.join(tmpdir(), `rpgm-json-collision-${Date.now()}`);
    const outDir = path.join(tmpdir(), `rpgm-json-collision-out-${Date.now()}`);
    await mkdir(path.join(root, "data"), { recursive: true });
    await mkdir(path.join(root, "js"), { recursive: true });
    await writeFile(path.join(root, "js", "rmmz_core.js"), "", "utf8");
    // The key "a.b" and the nested path a -> b both join to "a.b.text".
    await writeFile(
      path.join(root, "js", "plugins.js"),
      `var $plugins = ${JSON.stringify([
        {
          name: "P",
          status: true,
          parameters: {
            Data: JSON.stringify({ "a.b": { text: "Dotted" }, a: { b: { text: "Nested" } } })
          }
        }
      ])};\n`,
      "utf8"
    );

    const extractor = new RpgMakerMvMzExtractor();
    const units = await extractor.extract(root, { includePlugins: true });
    const dotted = units.find((unit) => unit.source === "Dotted");
    const nested = units.find((unit) => unit.source === "Nested");
    expect(dotted).toBeDefined();
    expect(nested).toBeDefined();
    // The old dotted-join collapsed both to ...$json.a.b.text.
    expect(dotted?.id).not.toBe(nested?.id);

    const result = await extractor.applyTranslations(
      root,
      [
        { id: dotted?.id ?? "", source: "Dotted", translation: "Точка", provider: "manual", model: "manual", status: "translated" },
        { id: nested?.id ?? "", source: "Nested", translation: "Вложено", provider: "manual", model: "manual", status: "translated" }
      ],
      { mode: "patch", outDir, includePlugins: true }
    );

    const patched = parsePluginsJs(await readFile(path.join(outDir, "js", "plugins.js"), "utf8"));
    expect(result.unitsApplied).toBe(2);
    expect(JSON.parse(patched[0].parameters?.Data as string)).toEqual({
      "a.b": { text: "Точка" },
      a: { b: { text: "Вложено" } }
    });
  });

  it("round-trips encoded JSON whose intermediate key contains a dot", async () => {
    const root = path.join(tmpdir(), `rpgm-dotted-json-${Date.now()}`);
    const outDir = path.join(tmpdir(), `rpgm-dotted-json-out-${Date.now()}`);
    await mkdir(path.join(root, "data"), { recursive: true });
    await mkdir(path.join(root, "js"), { recursive: true });
    await writeFile(path.join(root, "js", "rmmz_core.js"), "", "utf8");
    await writeFile(
      path.join(root, "js", "plugins.js"),
      `var $plugins = ${JSON.stringify([
        {
          name: "MenuPlugin",
          status: true,
          parameters: {
            Data: JSON.stringify({ "menu.title": { label: "Quest Log" } })
          }
        }
      ])};\n`,
      "utf8"
    );

    const extractor = new RpgMakerMvMzExtractor();
    const units = await extractor.extract(root, { includePlugins: true });
    const dottedUnit = units.find((unit) => unit.source === "Quest Log");
    expect(dottedUnit?.constraints).toMatchObject({
      sourceEncoding: "json-stringified-json",
      encodedJsonSegments: ["menu.title", "label"]
    });

    const result = await extractor.applyTranslations(
      root,
      [
        {
          id: dottedUnit?.id ?? "",
          source: "Quest Log",
          translation: "Журнал заданий",
          provider: "manual",
          model: "manual",
          status: "translated"
        }
      ],
      { mode: "patch", outDir, includePlugins: true }
    );

    const patched = parsePluginsJs(await readFile(path.join(outDir, "js", "plugins.js"), "utf8"));
    expect(result.unitsApplied).toBe(1);
    expect(JSON.parse(patched[0].parameters?.Data as string)).toEqual({ "menu.title": { label: "Журнал заданий" } });
  });
});

describe("replacePluginsArray line endings", () => {
  it("keeps a CRLF plugins.js on CRLF after rewriting the array", () => {
    const raw =
      "// Generated by RPG Maker.\r\n" +
      "var $plugins =\r\n" +
      JSON.stringify([{ name: "X", status: true, parameters: { title: "Old" } }], null, 2).replace(/\n/g, "\r\n") +
      ";\r\n";
    const rewritten = replacePluginsArray(raw, [{ name: "X", status: true, parameters: { title: "Новый" } }]);
    expect(rewritten).toContain("Новый");
    expect(rewritten).not.toMatch(/[^\r]\n/); // every LF is preceded by CR (no bare LF)
    expect(rewritten.startsWith("// Generated by RPG Maker.\r\n")).toBe(true);
  });

  it("keeps an LF plugins.js on LF", () => {
    const raw = `var $plugins = ${JSON.stringify([{ name: "X", parameters: { title: "Old" } }])};\n`;
    const rewritten = replacePluginsArray(raw, [{ name: "X", parameters: { title: "New" } }]);
    expect(rewritten).not.toContain("\r");
    expect(rewritten).toContain("New");
  });

  it("preserves a 4-space indented plugins.js instead of reformatting to 2 spaces", () => {
    const array = JSON.stringify([{ name: "X", status: true, parameters: { title: "Old" } }], null, 4);
    const raw = `var $plugins =\n${array};\n`;

    const rewritten = replacePluginsArray(raw, [{ name: "X", status: true, parameters: { title: "Новый" } }]);

    expect(rewritten).toContain("Новый");
    expect(rewritten).toContain("\n    {"); // the element stays indented by 4 spaces
    expect(rewritten).not.toContain("\n  {"); // and is not reformatted to 2 spaces
  });

  it("parses and rewrites a $plugins array even when trailing code follows it", () => {
    const raw =
      "var $plugins = " +
      JSON.stringify([{ name: "A", status: true, parameters: { title: "Old" } }]) +
      ';\nwindow.$plugins.push({ note: "extra ]" });\n';

    const plugins = parsePluginsJs(raw);
    expect(plugins).toHaveLength(1);
    expect(plugins[0].name).toBe("A");

    const rewritten = replacePluginsArray(raw, [{ name: "A", status: true, parameters: { title: "Новый" } }]);
    expect(rewritten).toContain("Новый");
    // The trailing statement (and its string holding a `]`) survives the rewrite.
    expect(rewritten).toContain('window.$plugins.push({ note: "extra ]" });');
  });
});

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
