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

export type EngineId = "rpgmaker-mv" | "rpgmaker-mz";
export type DetectedEngineId = EngineId | "unknown";

export type DetectedEngine = {
  engine: DetectedEngineId;
  rootPath: string;
  projectPath: string;
  dataPath?: string;
  pluginsPath?: string;
  confidence: "high" | "medium" | "low";
  reasons: string[];
};

export interface EngineDetector {
  detect(projectPath: string): Promise<DetectedEngine>;
}
