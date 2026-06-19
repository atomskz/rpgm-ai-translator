import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathExists, readJsonFile, writeJsonFile } from "../utils/fs.js";

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
  const sourceSystemPath = path.join(root, "data", "System.json");
  const outputSystemPath = path.join(outputRoot, "data", "System.json");
  const systemPathToRead = (await pathExists(outputSystemPath)) ? outputSystemPath : sourceSystemPath;
  const system = await readJsonFile<SystemJson>(systemPathToRead);
  const fontPath = path.resolve(options.fontPath);
  const numberFontPath = path.resolve(options.numberFontPath ?? options.fontPath);
  const fontFileName = path.basename(fontPath);
  const numberFontFileName = path.basename(numberFontPath);
  const outputFontsDir = path.join(outputRoot, "fonts");
  const filesWritten: string[] = [];

  await mkdir(outputFontsDir, { recursive: true });
  await copyFile(fontPath, path.join(outputFontsDir, fontFileName));
  filesWritten.push(path.join(outputFontsDir, fontFileName));

  if (numberFontPath !== fontPath) {
    await copyFile(numberFontPath, path.join(outputFontsDir, numberFontFileName));
    filesWritten.push(path.join(outputFontsDir, numberFontFileName));
  }

  system.advanced = {
    ...system.advanced,
    mainFontFilename: fontFileName,
    numberFontFilename: numberFontFileName,
    fallbackFonts: options.fallbackFonts ?? system.advanced?.fallbackFonts ?? "sans-serif"
  };

  await writeJsonFile(outputSystemPath, system);
  filesWritten.push(outputSystemPath);

  return { filesWritten };
}
