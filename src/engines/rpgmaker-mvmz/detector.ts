/*
 * This file is part of rpgm-ai-translator.
 *
 * Copyright (C) 2026 Nikita Fedorov
 *
 * rpgm-ai-translator is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * rpgm-ai-translator is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with rpgm-ai-translator. If not, see <https://www.gnu.org/licenses/>.
 */

import path from "node:path";
import type { EngineDetector } from "../../core/ports/public-api.js";
import type { DetectedEngine, DetectedEngineId } from "../../core/types/public-api.js";
import { isDirectory, pathExists, readJsonFile } from "../../core/utils/fs.js";

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
    } else {
      // No JS runtime to read the engine from (data-only export). Infer it from
      // System.json so a data/ folder still translates, with medium confidence
      // since the guess relies on a data marker rather than the runtime files.
      const dataEngine = await detectEngineFromData(dataPath);
      if (dataEngine) {
        engine = dataEngine.engine;
        confidence = "medium";
        reasons.push(`No MV/MZ runtime marker found; inferred ${engine} from data (${dataEngine.reason})`);
      } else {
        reasons.push("No MV/MZ runtime marker found");
      }
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

// Infer the engine from data/System.json when no JS runtime marker is present.
// RPG Maker MZ added the "advanced" section to System.json; MV has no such key,
// which makes it a reliable data-only discriminator. A readable System.json that
// is not an MZ project is treated as MV.
async function detectEngineFromData(
  dataPath: string
): Promise<{ engine: DetectedEngineId; reason: string } | undefined> {
  let system: Record<string, unknown>;
  try {
    system = await readJsonFile<Record<string, unknown>>(path.join(dataPath, "System.json"));
  } catch {
    return undefined;
  }
  if (typeof system !== "object" || system == null) {
    return undefined;
  }
  if (typeof system.advanced === "object" && system.advanced != null) {
    return { engine: "rpgmaker-mz", reason: "System.json has the MZ-only 'advanced' section" };
  }
  return { engine: "rpgmaker-mv", reason: "System.json lacks the MZ-only 'advanced' section" };
}
