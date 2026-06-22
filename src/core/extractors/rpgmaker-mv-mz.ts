import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type {
  ApplyOptions,
  ApplyResult,
  ExtractOptions,
  Extractor,
  TranslationResult,
  TranslationUnit
} from "../types.js";
import { MvMzEngineDetector } from "../engine-detector/index.js";
import { writePatch } from "../patch-writer/index.js";
import { readJsonFile, toPosixPath } from "../utils/fs.js";
import { extractFromKnownFile } from "./mv-mz/database.js";
import { extractPluginsJs } from "./mv-mz/plugins.js";
import { toTranslationUnit } from "./mv-mz/shared.js";

export class RpgMakerMvMzExtractor implements Extractor {
  constructor(private readonly detector = new MvMzEngineDetector()) {}

  async extract(projectPath: string, options: ExtractOptions = {}): Promise<TranslationUnit[]> {
    const detected = await this.detector.detect(projectPath);
    if (!detected.dataPath || detected.engine === "unknown") {
      throw new Error(`Unsupported or unknown RPG Maker engine for '${path.resolve(projectPath)}'`);
    }
    const dataPath = detected.dataPath;
    const engine = detected.engine;
    const entries = await readdir(dataPath, { withFileTypes: true });
    const jsonFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(dataPath, entry.name))
      .sort();

    const units: TranslationUnit[] = [];
    for (const filePath of jsonFiles) {
      const fileName = path.basename(filePath);
      const relativeFilePath = toPosixPath(path.relative(detected.projectPath, filePath));
      try {
        const data = await readJsonFile(filePath);
        const drafts = extractFromKnownFile(fileName, data, {
          absoluteFilePath: filePath,
          relativeFilePath,
          engine,
          extractOptions: options
        });
        units.push(...drafts.map(toTranslationUnit));
      } catch (error: unknown) {
        // Skip a corrupt or non-standard data file instead of aborting the run.
        options.onWarning?.(`Skipped ${relativeFilePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (options.includePlugins && detected.pluginsPath) {
      const relativeFilePath = toPosixPath(path.relative(detected.projectPath, detected.pluginsPath));
      try {
        units.push(
          ...extractPluginsJs(await readFile(detected.pluginsPath, "utf8"), {
            absoluteFilePath: detected.pluginsPath,
            relativeFilePath,
            engine
          }).map(toTranslationUnit)
        );
      } catch (error: unknown) {
        options.onWarning?.(`Skipped ${relativeFilePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return units;
  }

  async applyTranslations(
    projectPath: string,
    translations: TranslationResult[],
    options: ApplyOptions
  ): Promise<ApplyResult> {
    if (options.mode !== "patch" && options.mode !== "in-place") {
      throw new Error(`Apply mode '${options.mode}' is not implemented in the MVP`);
    }

    const units = await this.extract(projectPath, {
      includePlugins: options.includePlugins,
      includeSpeakerNames: options.includeSpeakerNames
    });
    return writePatch(projectPath, units, translations, options);
  }
}
