import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { ENGINE_ADAPTERS, detectEngine } from "../src/engines/registry.js";

describe("engine registry", () => {
  it("registers the rpgmaker-mvmz adapter with detector and extractor factories", () => {
    const ids = ENGINE_ADAPTERS.map((adapter) => adapter.id);
    expect(ids).toContain("rpgmaker-mvmz");
    for (const adapter of ENGINE_ADAPTERS) {
      const extractor = adapter.createExtractor();
      expect(typeof extractor.extract).toBe("function");
      expect(typeof extractor.applyTranslations).toBe("function");
      expect(typeof adapter.createDetector().detect).toBe("function");
    }
  });

  it("detects a project and returns the adapter that recognized it", async () => {
    const root = await makeProject("mz");

    const { detected, adapter } = await detectEngine(root);

    expect(detected.engine).toBe("rpgmaker-mz");
    expect(adapter.id).toBe("rpgmaker-mvmz");
    // The returned adapter's extractor is the one a command would use, with no
    // second lookup or concrete class named in the command.
    expect(typeof adapter.createExtractor().extract).toBe("function");
  });

  it("returns an unknown detection (with a fallback adapter) for an unrelated folder", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rpgm-registry-unknown-"));

    const { detected, adapter } = await detectEngine(root);

    expect(detected.engine).toBe("unknown");
    expect(adapter.id).toBe("rpgmaker-mvmz");
  });
});

async function makeProject(engine: "mv" | "mz"): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), `rpgm-registry-${engine}-`));
  const dataDir = path.join(root, "data");
  const jsDir = path.join(root, "js");
  await mkdir(dataDir, { recursive: true });
  await mkdir(jsDir, { recursive: true });
  await writeFile(path.join(dataDir, "System.json"), "{}", "utf8");
  await writeFile(path.join(jsDir, engine === "mv" ? "rpg_core.js" : "rmmz_core.js"), "", "utf8");
  return root;
}
