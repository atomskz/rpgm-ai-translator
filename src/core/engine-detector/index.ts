import path from "node:path";
import type { DetectedEngine, DetectedEngineId, EngineDetector } from "../types.js";
import { isDirectory, pathExists, readJsonFile } from "../utils/fs.js";

export class MvMzEngineDetector implements EngineDetector {
  async detect(projectPath: string): Promise<DetectedEngine> {
    const root = path.resolve(projectPath);
    const dataPath = await findDataPath(root);
    if (!dataPath) {
      return {
        engine: "unknown",
        rootPath: root,
        projectPath: root,
        confidence: "low",
        reasons: [`RPG Maker MV/MZ data directory was not found in '${root}'`]
      };
    }

    const jsPath = dataPath.endsWith(`${path.sep}www${path.sep}data`)
      ? path.join(root, "www", "js")
      : path.join(root, "js");
    const pluginsPath = path.join(jsPath, "plugins.js");

    const reasons: string[] = [`Found data directory: ${path.relative(root, dataPath) || "."}`];
    const mzMarkers = ["rmmz_core.js", "rmmz_managers.js", "rmmz_windows.js", "rmmz_objects.js", "rmmz_scenes.js"];
    const mvMarkers = ["rpg_core.js", "rpg_managers.js", "rpg_windows.js", "rpg_objects.js", "rpg_scenes.js"];

    const hasMzMarker = await hasAnyFile(jsPath, mzMarkers);
    const hasMvMarker = await hasAnyFile(jsPath, mvMarkers);

    let engine: DetectedEngineId = "unknown";
    let confidence: DetectedEngine["confidence"] = "low";

    if (hasMzMarker) {
      engine = "rpgmaker-mz";
      confidence = "high";
      reasons.push("Found RPG Maker MZ runtime marker rmmz_*.js");
    } else if (hasMvMarker) {
      engine = "rpgmaker-mv";
      confidence = "high";
      reasons.push("Found RPG Maker MV runtime marker rpg_*.js");
    } else if (await looksLikeJsonData(dataPath)) {
      reasons.push("No MV/MZ runtime marker found; JSON data alone is not enough to distinguish the engine");
    } else {
      reasons.push("No MV/MZ runtime marker found");
    }

    if (await pathExists(pluginsPath)) {
      reasons.push(`Found plugins file: ${path.relative(root, pluginsPath)}`);
    }

    return {
      engine,
      rootPath: root,
      projectPath: root,
      dataPath,
      pluginsPath: (await pathExists(pluginsPath)) ? pluginsPath : undefined,
      confidence,
      reasons
    };
  }
}

async function findDataPath(projectPath: string): Promise<string | undefined> {
  const candidates = [path.join(projectPath, "data"), path.join(projectPath, "www", "data")];
  for (const candidate of candidates) {
    if (await isDirectory(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function hasAnyFile(directory: string, fileNames: string[]): Promise<boolean> {
  for (const fileName of fileNames) {
    if (await pathExists(path.join(directory, fileName))) {
      return true;
    }
  }
  return false;
}

async function looksLikeJsonData(dataPath: string): Promise<boolean> {
  try {
    const system = await readJsonFile<Record<string, unknown>>(path.join(dataPath, "System.json"));
    return typeof system === "object" && system != null;
  } catch {
    return false;
  }
}
