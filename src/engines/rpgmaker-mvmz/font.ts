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

import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { MvMzEngineDetector } from "./detector.js";
import { pathExists, readJsonFile, writeFileAtomic, writeJsonFile } from "../../core/utils/fs.js";

type SystemJson = {
  advanced?: {
    mainFontFilename?: string | null;
    numberFontFilename?: string | null;
    fallbackFonts?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type FontPatchOptions = {
  fontPath: string;
  numberFontPath?: string;
  fallbackFonts?: string;
  onWarning?: (message: string) => void;
};

export type FontPatchResult = {
  filesWritten: string[];
};

export async function applyFontPatch(
  projectPath: string,
  outDir: string,
  options: FontPatchOptions
): Promise<FontPatchResult> {
  const root = path.resolve(projectPath);
  const outputRoot = path.resolve(outDir);

  // MV and MZ resolve fonts through different mechanisms and a deployed game keeps
  // its data under `www/`, so detect the engine and locate the real content layout
  // instead of assuming an MZ project at `<root>/data`.
  const detected = await new MvMzEngineDetector().detect(projectPath);
  if (detected.engine === "unknown" || !detected.dataPath) {
    throw new Error(
      `Cannot font-patch '${projectPath}': not a recognized RPG Maker MV/MZ project (no data directory or engine marker found).`
    );
  }
  // "" for a root layout, "www" for a deployed www/ layout. Mirror it in the output.
  const contentPrefix = path.dirname(path.relative(root, detected.dataPath));
  const outputFontsDir = path.join(outputRoot, contentPrefix, "fonts");

  const fontPath = path.resolve(options.fontPath);
  const numberFontPath = path.resolve(options.numberFontPath ?? options.fontPath);
  const fontFileName = path.basename(fontPath);
  const numberFontFileName = path.basename(numberFontPath);
  const filesWritten: string[] = [];

  await mkdir(outputFontsDir, { recursive: true });
  await copyFile(fontPath, path.join(outputFontsDir, fontFileName));
  filesWritten.push(path.join(outputFontsDir, fontFileName));

  if (numberFontPath !== fontPath) {
    await copyFile(numberFontPath, path.join(outputFontsDir, numberFontFileName));
    filesWritten.push(path.join(outputFontsDir, numberFontFileName));
  }

  if (detected.engine === "rpgmaker-mz") {
    // MZ reads the UI/number font from System.json's `advanced` section.
    const sourceSystemPath = path.join(detected.dataPath, "System.json");
    const outputSystemPath = path.join(outputRoot, contentPrefix, "data", "System.json");
    const systemPathToRead = (await pathExists(outputSystemPath)) ? outputSystemPath : sourceSystemPath;
    const system = await readJsonFile<SystemJson>(systemPathToRead);
    system.advanced = {
      ...system.advanced,
      mainFontFilename: fontFileName,
      numberFontFilename: numberFontFileName,
      fallbackFonts: options.fallbackFonts ?? system.advanced?.fallbackFonts ?? "sans-serif"
    };
    await writeJsonFile(outputSystemPath, system);
    filesWritten.push(outputSystemPath);
  } else {
    // MV resolves the UI font through `fonts/gamefont.css` (the "GameFont"
    // @font-face), not System.json. Rewrite that CSS to point GameFont at the
    // patched font. MV has no separate number-font hook, so a distinct
    // --number-font is not applied here.
    if (numberFontPath !== fontPath) {
      options.onWarning?.(
        "RPG Maker MV uses a single UI font (GameFont); --number-font is ignored (it is an MZ-only setting)."
      );
    }
    const gameFontCssPath = path.join(outputFontsDir, "gamefont.css");
    const css = `@font-face {\n  font-family: GameFont;\n  src: url("${fontFileName}");\n}\n`;
    await writeFileAtomic(gameFontCssPath, css);
    filesWritten.push(gameFontCssPath);
  }

  return { filesWritten };
}
