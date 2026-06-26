import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { RpgMakerMvMzExtractor } from "../src/engines/rpgmaker-mvmz/extractor.js";

// Consolidated extraction edge-case fixtures: MV-vs-MZ plugin codes, encoded
// plugin params, empty/missing fields, and CRLF/BOM data files.
describe("extraction fixtures", () => {
  async function project(engine: "mv" | "mz"): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), `rpgm-fixture-${engine}-`));
    await mkdir(path.join(root, "data"), { recursive: true });
    await mkdir(path.join(root, "js"), { recursive: true });
    await writeFile(path.join(root, "js", engine === "mv" ? "rpg_core.js" : "rmmz_core.js"), "", "utf8");
    return root;
  }

  it("skips empty rows and missing fields without producing spurious units", async () => {
    const root = await project("mz");
    await writeFile(
      path.join(root, "data", "Actors.json"),
      JSON.stringify([null, { id: 1, name: "Aria" }, { id: 2 }, { id: 3, name: "", profile: "   " }]),
      "utf8"
    );

    const units = await new RpgMakerMvMzExtractor().extract(root);

    // Only the one real name is extracted; null rows, missing fields, and empty or
    // whitespace-only strings produce nothing.
    expect(units.map((unit) => unit.id)).toEqual(["Actors.1.name"]);
  });

  it("extracts CRLF dialogue, preserving the line break and counting lines", async () => {
    const root = await project("mz");
    await writeFile(
      path.join(root, "data", "Map001.json"),
      JSON.stringify({
        events: [null, { id: 1, name: "NPC", pages: [{ list: [{ code: 401, parameters: ["First line.\r\nSecond line."] }] }] }]
      }),
      "utf8"
    );

    const units = await new RpgMakerMvMzExtractor().extract(root);
    const dialogue = units.find((unit) => unit.category === "dialogue");

    expect(dialogue?.source).toContain("\r\n");
    // A CRLF inside the source is preserved; a single Show Text line keeps maxLines 1.
    expect(dialogue?.constraints).toMatchObject({ preserveNewlines: true, maxLines: 1 });
  });

  it("reads a BOM-prefixed System.json instead of skipping it", async () => {
    const root = await project("mz");
    const bom = String.fromCharCode(0xfeff);
    await writeFile(path.join(root, "data", "System.json"), `${bom}${JSON.stringify({ gameTitle: "Moonfall" })}`, "utf8");

    const units = await new RpgMakerMvMzExtractor().extract(root);

    expect(units.find((unit) => unit.id === "System.gameTitle")?.source).toBe("Moonfall");
  });

  it("extracts MV (356) and MZ (357) plugin command text under --include-plugins", async () => {
    const mv = await project("mv");
    await writeFile(
      path.join(mv, "data", "CommonEvents.json"),
      JSON.stringify([null, { id: 1, name: "CE", list: [{ code: 356, parameters: ["GabText Hello there"] }] }]),
      "utf8"
    );
    const mvUnits = await new RpgMakerMvMzExtractor().extract(mv, { includePlugins: true });
    expect(mvUnits.some((unit) => unit.source.includes("Hello there"))).toBe(true);

    const mz = await project("mz");
    await writeFile(
      path.join(mz, "data", "CommonEvents.json"),
      JSON.stringify([
        null,
        {
          id: 1,
          name: "CE",
          list: [{ code: 357, parameters: ["Plugin", "show", "", { messageText: "Greetings traveller" }] }]
        }
      ]),
      "utf8"
    );
    const mzUnits = await new RpgMakerMvMzExtractor().extract(mz, { includePlugins: true });
    expect(mzUnits.some((unit) => unit.source.includes("Greetings traveller"))).toBe(true);
  });
});
