import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { RpgMakerMvMzExtractor } from "../src/core/extractors/index.js";
import { runCli } from "../src/cli/app.js";
import { hashSource } from "../src/core/utils/hash.js";

describe("RpgMakerMvMzExtractor", () => {
  it("extracts database strings, map dialogue, and choices", async () => {
    const root = await makeProject("mz");
    await writeJson(path.join(root, "data", "Actors.json"), [
      null,
      { id: 1, name: "Aria", nickname: "Blade", profile: "A wandering knight." }
    ]);
    await writeJson(path.join(root, "data", "Items.json"), [
      null,
      { id: 1, name: "Potion", description: String.raw`Restores \V[1] HP.` }
    ]);
    await writeJson(path.join(root, "data", "Map001.json"), {
      displayName: "Town",
      events: [
        null,
        {
          id: 1,
          name: "Innkeeper",
          pages: [
            {
              list: [
                { code: 101, parameters: ["", 0, 0, 2, "Innkeeper"] },
                { code: 401, parameters: [String.raw`Hello, \N[1]!`] },
                { code: 102, parameters: [["Rest", "Leave"], 0, 0, 2, 0] },
                { code: 122, parameters: [1, 1, 0, 4, JSON.stringify("Find the lost ring.")] },
                {
                  code: 357,
                  parameters: [
                    "LL_InfoPopupWIndow",
                    "showMessage",
                    "",
                    {
                      messageText: "Silver Ring",
                      choices: JSON.stringify([{ label: "Give the ring?" }, { label: "Keep it" }])
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    });

    const units = await new RpgMakerMvMzExtractor().extract(root);

    expect(units.map((unit) => unit.id)).toEqual([
      "Actors.1.name",
      "Actors.1.nickname",
      "Actors.1.profile",
      "Items.1.name",
      "Items.1.description",
      "Map001.displayName",
      "Map001.events.1.pages.0.list.1.parameters.0",
      "Map001.events.1.pages.0.list.2.parameters.0.0",
      "Map001.events.1.pages.0.list.2.parameters.0.1",
      "Map001.events.1.pages.0.list.3.parameters.4",
      "Map001.events.1.pages.0.list.4.parameters.3.messageText",
      "Map001.events.1.pages.0.list.4.parameters.3.choices.$json.0.label",
      "Map001.events.1.pages.0.list.4.parameters.3.choices.$json.1.label"
    ]);

    const dialogue = units.find((unit) => unit.id === "Map001.events.1.pages.0.list.1.parameters.0");
    expect(dialogue?.category).toBe("dialogue");
    expect(dialogue?.normalizedSource).toBe("Hello, <PH_1>!");
    expect(dialogue?.placeholders?.[0].value).toBe(String.raw`\N[1]`);
    expect(dialogue?.constraints).toMatchObject({ maxLines: 1, maxLength: 52 });
    expect(dialogue?.context?.speaker).toBe("Innkeeper");
    expect(units.find((unit) => unit.id === "Map001.events.1.pages.0.list.3.parameters.4")).toMatchObject({
      source: "Find the lost ring.",
      category: "system",
      constraints: { maxLines: 1, maxLength: 54, sourceEncoding: "json-string-literal" }
    });
    expect(units.find((unit) => unit.id === "Map001.events.1.pages.0.list.4.parameters.3.messageText")).toMatchObject({
      source: "Silver Ring",
      category: "system",
      constraints: { maxLines: 1, maxLength: 48 }
    });
    expect(units.find((unit) => unit.id === "Map001.events.1.pages.0.list.4.parameters.3.choices.$json.0.label")).toMatchObject({
      source: "Give the ring?",
      jsonPath: "events.1.pages.0.list.4.parameters.3.choices",
      constraints: { sourceEncoding: "json-stringified-json", encodedJsonPath: "0.label" }
    });
  });

  it("extracts stable units from multiple database JSON files and skips empty strings", async () => {
    const root = await makeProject("mv");
    await writeJson(path.join(root, "data", "Classes.json"), [
      null,
      { id: 1, name: "Warrior", description: "" }
    ]);
    await writeJson(path.join(root, "data", "Skills.json"), [
      null,
      {
        id: 1,
        name: "Fire",
        description: "Deals fire damage.",
        message1: "%1 casts Fire!",
        message2: ""
      }
    ]);
    await writeJson(path.join(root, "data", "System.json"), {
      gameTitle: "Moonfall",
      currencyUnit: "G",
      elements: ["", "Fire", "Ice"],
      terms: {
        basic: ["", "Level"],
        commands: ["Fight", "Escape"]
      }
    });
    await writeJson(path.join(root, "data", "MapInfos.json"), [null, { id: 1, name: "Old Road" }]);

    const units = await new RpgMakerMvMzExtractor().extract(root);
    const byId = new Map(units.map((unit) => [unit.id, unit]));

    expect([...byId.keys()]).toEqual([
      "Classes.1.name",
      "MapInfos.1.name",
      "Skills.1.name",
      "Skills.1.description",
      "Skills.1.message1",
      "System.gameTitle",
      "System.currencyUnit",
      "System.elements.1",
      "System.elements.2",
      "System.terms.basic.1",
      "System.terms.commands.0",
      "System.terms.commands.1"
    ]);
    expect(byId.get("Classes.1.name")).toMatchObject({
      source: "Warrior",
      filePath: "data/Classes.json",
      jsonPath: "1.name",
      engine: "rpgmaker-mv",
      category: "name",
      hash: hashSource("Warrior")
    });
    expect(units.some((unit) => unit.source === "")).toBe(false);
    expect(byId.get("Skills.1.message1")?.normalizedSource).toBe("<PH_1> casts Fire!");
  });

  it("writes extracted units to a file from the CLI", async () => {
    const root = await makeProject("mv");
    const out = path.join(root, "units.json");
    await writeJson(path.join(root, "data", "Actors.json"), [null, { id: 1, name: "Aria" }]);

    const exitCode = await runCli(["extract", root, "--out", out], {
      stdout: () => undefined,
      stderr: () => undefined
    });

    const units = JSON.parse(await readFile(out, "utf8"));
    expect(exitCode).toBe(0);
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({
      id: "Actors.1.name",
      jsonPath: "1.name",
      source: "Aria"
    });
  });

  it("extracts map and common event command text with event context", async () => {
    const root = await makeProject("mz");
    await writeJson(path.join(root, "data", "Map001.json"), {
      displayName: "Town",
      events: [
        null,
        {
          id: 7,
          name: "Gatekeeper",
          pages: [
            {
              list: [
                { code: 101, parameters: ["", 0, 0, 2, "Guard"] },
                { code: 401, parameters: ["First line."] },
                { code: 401, parameters: ["Second line."] },
                { code: 102, parameters: [["Yes", "No"], 0, 0, 2, 0] },
                { code: 105, parameters: [2, false] },
                { code: 405, parameters: ["Ancient text scrolls by."] },
                { code: 108, parameters: ["Translator note"] },
                { code: 408, parameters: ["Continuation note"] }
              ]
            }
          ]
        }
      ]
    });
    await writeJson(path.join(root, "data", "CommonEvents.json"), [
      null,
      {
        id: 3,
        name: "Camp",
        list: [{ code: 401, parameters: ["Rest here?"] }]
      }
    ]);

    const withoutComments = await new RpgMakerMvMzExtractor().extract(root);
    const withComments = await new RpgMakerMvMzExtractor().extract(root, { includeEventComments: true });
    const withSpeakerNames = await new RpgMakerMvMzExtractor().extract(root, { includeSpeakerNames: true });
    const byId = new Map(withComments.map((unit) => [unit.id, unit]));

    expect(withoutComments.some((unit) => unit.source === "Translator note")).toBe(false);
    expect(withoutComments.some((unit) => unit.id === "Map001.events.1.pages.0.list.0.parameters.4")).toBe(false);
    expect(withSpeakerNames).toContainEqual(
      expect.objectContaining({
        id: "Map001.events.1.pages.0.list.0.parameters.4",
        source: "Guard",
        category: "name"
      })
    );
    expect(byId.get("Map001.events.1.pages.0.list.1.parameters.0")).toMatchObject({
      source: "First line.",
      category: "dialogue",
      context: {
        mapName: "Town",
        eventId: 7,
        eventName: "Gatekeeper",
        speaker: "Guard",
        previousLines: [],
        nextLines: ["Second line.", "Yes / No"]
      }
    });
    expect(byId.get("Map001.events.1.pages.0.list.3.parameters.0.0")).toMatchObject({
      source: "Yes",
      category: "choice",
      context: {
        previousLines: ["First line.", "Second line."],
        nextLines: ["Ancient text scrolls by.", "Translator note"]
      }
    });
    expect(byId.get("Map001.events.1.pages.0.list.5.parameters.0")).toMatchObject({
      source: "Ancient text scrolls by.",
      category: "dialogue"
    });
    expect(byId.get("Map001.events.1.pages.0.list.6.parameters.0")).toMatchObject({
      source: "Translator note",
      category: "unknown"
    });
    expect(byId.get("CommonEvents.1.list.0.parameters.0")).toMatchObject({
      source: "Rest here?",
      context: {
        eventId: 3,
        eventName: "Camp"
      }
    });
  });

  it("extracts safe direct plugin parameters only when enabled", async () => {
    const root = await makeProject("mz");
    await writeFile(
      path.join(root, "js", "plugins.js"),
      `var $plugins = ${JSON.stringify([
        {
          name: "MenuPlugin",
          status: true,
          parameters: {
            CommandName: "Auto Recover",
            Commands: JSON.stringify([{ label: "Quest Log" }]),
            BackgroundImage: "MainMenu",
            Enabled: "true",
            Formula: "$gameVariables.value(1)",
            RawNumber: 42
          }
        }
      ])};\n`,
      "utf8"
    );

    const withoutPlugins = await new RpgMakerMvMzExtractor().extract(root);
    const withPlugins = await new RpgMakerMvMzExtractor().extract(root, { includePlugins: true });

    expect(withoutPlugins.some((unit) => unit.category === "plugin-parameter")).toBe(false);
    expect(withPlugins).toContainEqual(
      expect.objectContaining({
        id: "plugins.0.parameters.CommandName",
        source: "Auto Recover",
        filePath: "js/plugins.js",
        jsonPath: "0.parameters.CommandName",
        category: "plugin-parameter",
        context: { eventName: "MenuPlugin" }
      })
    );
    expect(withPlugins).toContainEqual(
      expect.objectContaining({
        id: "plugins.0.parameters.Commands.$json.0.label",
        source: "Quest Log",
        filePath: "js/plugins.js",
        jsonPath: "0.parameters.Commands",
        category: "plugin-parameter",
        constraints: expect.objectContaining({
          sourceEncoding: "json-stringified-json",
          encodedJsonPath: "0.label"
        })
      })
    );
    expect(withPlugins.some((unit) => unit.source === "MainMenu")).toBe(false);
    expect(withPlugins.some((unit) => unit.source === "true")).toBe(false);
  });

  it("extracts CJK-only database names and descriptions while still skipping unsafe strings", async () => {
    const root = await makeProject("mz");
    await writeJson(path.join(root, "data", "Items.json"), [
      null,
      { id: 1, name: "勇者の剣", description: "伝説の力を宿した剣。" },
      { id: 2, name: "Audio.ogg", description: "true" }
    ]);

    const units = await new RpgMakerMvMzExtractor().extract(root);
    const byId = new Map(units.map((unit) => [unit.id, unit]));

    expect(byId.get("Items.1.name")?.source).toBe("勇者の剣");
    expect(byId.get("Items.1.description")?.source).toBe("伝説の力を宿した剣。");
    expect(units.some((unit) => unit.source === "Audio.ogg")).toBe(false);
    expect(units.some((unit) => unit.source === "true")).toBe(false);
  });
});

async function makeProject(engine: "mv" | "mz"): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), `rpgm-extractor-${engine}-`));
  await mkdir(path.join(root, "data"), { recursive: true });
  await mkdir(path.join(root, "js"), { recursive: true });
  await writeFile(path.join(root, "js", engine === "mv" ? "rpg_core.js" : "rmmz_core.js"), "", "utf8");
  return root;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
