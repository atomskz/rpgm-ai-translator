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

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Extractor } from "../../core/ports/public-api.js";
import type {
  ApplyOptions,
  ApplyResult,
  ExtractOptions,
  TranslationResult,
  TranslationUnit
} from "../../core/types/public-api.js";
import { MvMzEngineDetector } from "./detector.js";
import { writePatch } from "./patch/public-api.js";
import { readJsonFile, toPosixPath } from "../../core/utils/fs.js";
import { extractFromKnownFile } from "./extract/database.js";
import { extractPluginsJs } from "./extract/plugins.js";
import { toTranslationUnit } from "./extract/shared.js";

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
      includeEventComments: options.includeEventComments,
      includePlugins: options.includePlugins,
      includeSpeakerNames: options.includeSpeakerNames,
      includeNotes: options.includeNotes,
      dialogueMaxLength: options.dialogueMaxLength
    });
    return writePatch(projectPath, units, translations, options);
  }
}
