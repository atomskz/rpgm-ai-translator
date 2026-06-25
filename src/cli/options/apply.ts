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

import type { ApplyOptions, ExtractOptions } from "../../core/types/types.js";
import { hasFlag, readOption, readPositiveIntegerOption } from "./readers.js";
import { UsageError } from "./usage-error.js";

export type FontCliOptions = {
  fontPath?: string;
  numberFontPath?: string;
};

export function readExtractOptions(args: string[]): ExtractOptions {
  return {
    includeEventComments: hasFlag(args, "--include-comments"),
    includePlugins: hasFlag(args, "--include-plugins"),
    includeSpeakerNames: hasFlag(args, "--include-speaker-names"),
    dialogueMaxLength: readPositiveIntegerOption(args, "--dialogue-max-length")
  };
}

const APPLY_MODES = ["patch", "in-place"] as const;

export function readApplyMode(args: string[]): ApplyOptions["mode"] {
  const value = readOption(args, "--mode");
  if (value == null) {
    return "patch";
  }
  if (!(APPLY_MODES as readonly string[]).includes(value)) {
    throw new UsageError(`--mode must be one of ${APPLY_MODES.join(", ")}, got '${value}'`);
  }
  return value as ApplyOptions["mode"];
}

export function readApplyOptions(args: string[]): ApplyOptions {
  return {
    mode: readApplyMode(args),
    outDir: readOption(args, "--out"),
    backupDir: readOption(args, "--backup"),
    includeEventComments: hasFlag(args, "--include-comments"),
    includePlugins: hasFlag(args, "--include-plugins"),
    includeSpeakerNames: hasFlag(args, "--include-speaker-names"),
    dialogueMaxLength: readPositiveIntegerOption(args, "--dialogue-max-length"),
    dryRun: hasFlag(args, "--dry-run")
  };
}

export function readFontOptions(args: string[]): FontCliOptions {
  return {
    fontPath: readOption(args, "--font"),
    numberFontPath: readOption(args, "--number-font")
  };
}
