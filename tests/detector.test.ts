import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { MvMzEngineDetector } from "../src/core/engine-detector/index.js";
import { runCli } from "../src/cli/app.js";

describe("MvMzEngineDetector", () => {
  it("detects RPG Maker MZ by runtime markers", async () => {
    const root = await makeProject("mz");

    const detected = await new MvMzEngineDetector().detect(root);

    expect(detected.engine).toBe("rpgmaker-mz");
    expect(detected.rootPath).toBe(root);
    expect(detected.dataPath).toBe(path.join(root, "data"));
    expect(detected.confidence).toBe("high");
  });

  it("detects RPG Maker MV and plugins path by runtime markers", async () => {
    const root = await makeProject("mv");
    await writeFile(path.join(root, "js", "plugins.js"), "[]", "utf8");

    const detected = await new MvMzEngineDetector().detect(root);

    expect(detected.engine).toBe("rpgmaker-mv");
    expect(detected.pluginsPath).toBe(path.join(root, "js", "plugins.js"));
    expect(detected.confidence).toBe("high");
  });

  it("finds www/data projects", async () => {
    const root = await makeProject("mz", true);

    const detected = await new MvMzEngineDetector().detect(root);

    expect(detected.engine).toBe("rpgmaker-mz");
    expect(detected.dataPath).toBe(path.join(root, "www", "data"));
  });

  it("returns unknown for unrelated folders", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-unknown-"));

    const detected = await new MvMzEngineDetector().detect(root);

    expect(detected.engine).toBe("unknown");
    expect(detected.dataPath).toBeUndefined();
    expect(detected.confidence).toBe("low");
  });

  it("prints detection result as JSON from the CLI", async () => {
    const root = await makeProject("mv");
    const output: string[] = [];

    const exitCode = await runCli(["detect", root], {
      stdout: (text) => output.push(text),
      stderr: () => undefined
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(output.join(""))).toMatchObject({
      engine: "rpgmaker-mv",
      dataPath: path.join(root, "data")
    });
  });
});

async function makeProject(engine: "mv" | "mz", useWww = false): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), `rpgm-${engine}-`));
  const dataDir = useWww ? path.join(root, "www", "data") : path.join(root, "data");
  const jsDir = useWww ? path.join(root, "www", "js") : path.join(root, "js");
  await mkdir(dataDir, { recursive: true });
  await mkdir(jsDir, { recursive: true });
  await writeFile(path.join(dataDir, "System.json"), "{}", "utf8");
  await writeFile(path.join(jsDir, engine === "mv" ? "rpg_core.js" : "rmmz_core.js"), "", "utf8");
  return root;
}
