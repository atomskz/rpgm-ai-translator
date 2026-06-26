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

import type { EngineDetector, Extractor } from "../core/ports/public-api.js";
import type { DetectedEngine } from "../core/types/public-api.js";
import { MvMzEngineDetector, RpgMakerMvMzExtractor } from "./rpgmaker-mvmz/public-api.js";

// One registered engine adapter: a stable id plus factories for its detector and
// extractor (the Extractor/EngineDetector ports). `id` names the adapter family
// (e.g. rpgmaker-mvmz handles both MV and MZ), distinct from the per-variant
// DetectedEngineId a detection reports.
export type EngineAdapter = {
  id: string;
  createDetector(): EngineDetector;
  createExtractor(): Extractor;
};

// Single source of truth for which engines exist. Adding an engine is one entry
// here plus its adapter folder under engines/ — the commands resolve the detector
// and extractor through this registry (detectEngine) instead of naming a concrete
// engine class, so a new engine is a sibling adapter rather than an edit in every
// command.
export const ENGINE_ADAPTERS: readonly EngineAdapter[] = [
  {
    id: "rpgmaker-mvmz",
    createDetector: () => new MvMzEngineDetector(),
    createExtractor: () => new RpgMakerMvMzExtractor()
  }
];

export type EngineDetection = { detected: DetectedEngine; adapter: EngineAdapter };

// Detect the project against every registered engine, returning the first that
// recognizes it together with the adapter that did (so the caller gets the
// matching extractor without a second lookup). When none recognize it, returns
// the first adapter's "unknown" detection so the message still explains why.
export async function detectEngine(projectPath: string): Promise<EngineDetection> {
  let fallback: EngineDetection | undefined;
  for (const adapter of ENGINE_ADAPTERS) {
    const detected = await adapter.createDetector().detect(projectPath);
    if (detected.engine !== "unknown") {
      return { detected, adapter };
    }
    fallback ??= { detected, adapter };
  }
  // ENGINE_ADAPTERS is never empty, so a fallback is always assigned above.
  return fallback as EngineDetection;
}
