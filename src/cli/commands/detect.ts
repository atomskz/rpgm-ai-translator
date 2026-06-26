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

import { detectEngine } from "../../engines/registry.js";
import { requirePositional } from "../options/public-api.js";
import type { CliIO } from "../types.js";

export async function detectCommand(args: string[], io: CliIO): Promise<number> {
  const projectPath = requirePositional(args, 0, "project path");
  const { detected } = await detectEngine(projectPath);
  io.stdout(`${JSON.stringify(detected, null, 2)}\n`);
  // Exit non-zero on an unrecognized project so a wrapping script can branch on the
  // result with `$?` instead of having to parse the JSON for "engine": "unknown".
  if (detected.engine === "unknown") {
    io.stderr(`Could not detect a supported RPG Maker MV/MZ project at '${projectPath}'.\n`);
    return 1;
  }
  return 0;
}
