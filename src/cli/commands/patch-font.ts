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

import { applyFontPatch } from "../../core/font-patch/index.js";
import { readFontOptions, requireOption, requirePositional } from "../options.js";
import type { CliIO } from "../types.js";

export async function patchFontCommand(args: string[], io: CliIO): Promise<number> {
  const projectPath = requirePositional(args, 0, "project path");
  const outDir = requireOption(args, "--out");
  const fontPath = requireOption(args, "--font");
  const { numberFontPath } = readFontOptions(args);
  const result = await applyFontPatch(projectPath, outDir, {
    fontPath,
    numberFontPath,
    onWarning: (message) => io.stderr(`Warning: ${message}\n`)
  });
  io.stdout(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}
