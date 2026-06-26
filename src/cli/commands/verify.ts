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

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathExists, readJsonFile } from "../../core/utils/fs.js";
import { assertPatchOutputOutsideGame, parsePluginsJs } from "../../engines/rpgmaker-mvmz/public-api.js";
import { requirePositional } from "../options/public-api.js";
import type { CliIO } from "../types.js";

type FileCheck = { file: string; ok: boolean; reason?: string };

// Post-hoc check of a written patch against the game it overlays: confirm the patch
// directory is outside the game, then re-parse each patch JSON / plugins.js and
// confirm it structurally matches the corresponding game file (same top-level
// shape, no orphan files). Exits non-zero if anything fails, so a CI step or a
// translator can confirm a shipped patch is well-formed before distributing it.
export async function verifyCommand(args: string[], io: CliIO): Promise<number> {
  const gamePath = requirePositional(args, 0, "game path");
  const patchPath = requirePositional(args, 1, "patch path");

  try {
    assertPatchOutputOutsideGame(gamePath, patchPath);
  } catch (error: unknown) {
    io.stderr(`Patch directory is not safely separate from the game: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  if (!(await pathExists(patchPath))) {
    io.stderr(`Patch directory '${patchPath}' does not exist.\n`);
    return 1;
  }

  const files = await listDataFiles(patchPath);
  const checks: FileCheck[] = [];
  for (const relativePath of files) {
    checks.push(await checkFile(gamePath, patchPath, relativePath));
  }

  const failed = checks.filter((check) => !check.ok);
  io.stdout(
    `Verified ${checks.length} patch file${checks.length === 1 ? "" : "s"} against the game: ${checks.length - failed.length} ok, ${failed.length} failed.\n`
  );
  for (const check of failed) {
    io.stdout(`- ${check.file}: ${check.reason}\n`);
  }
  return failed.length === 0 ? 0 : 1;
}

// Patch data files to re-parse: JSON data and plugins.js. Other assets (images,
// audio) are copied verbatim and have no structure to verify, so they are skipped;
// dotfiles (a stray lock) are skipped too.
async function listDataFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, rel: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const childRel = rel ? path.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), childRel);
      } else if (entry.isFile() && (entry.name.endsWith(".json") || entry.name === "plugins.js")) {
        out.push(childRel);
      }
    }
  }
  await walk(root, "");
  return out.sort();
}

async function checkFile(gameRoot: string, patchRoot: string, relativePath: string): Promise<FileCheck> {
  const patchFile = path.join(patchRoot, relativePath);
  const gameFile = path.join(gameRoot, relativePath);
  if (!(await pathExists(gameFile))) {
    return { file: relativePath, ok: false, reason: "no corresponding file in the game (orphan patch file)" };
  }

  if (path.basename(relativePath) === "plugins.js") {
    return checkPluginsFile(patchFile, gameFile, relativePath);
  }
  return checkJsonFile(patchFile, gameFile, relativePath);
}

async function checkJsonFile(patchFile: string, gameFile: string, relativePath: string): Promise<FileCheck> {
  let patchData: unknown;
  try {
    patchData = await readJsonFile(patchFile);
  } catch (error: unknown) {
    return { file: relativePath, ok: false, reason: `patch JSON does not parse (${errorMessage(error)})` };
  }
  let gameData: unknown;
  try {
    gameData = await readJsonFile(gameFile);
  } catch (error: unknown) {
    return { file: relativePath, ok: false, reason: `game JSON does not parse (${errorMessage(error)})` };
  }
  const mismatch = structureMismatch(patchData, gameData);
  return mismatch ? { file: relativePath, ok: false, reason: mismatch } : { file: relativePath, ok: true };
}

async function checkPluginsFile(patchFile: string, gameFile: string, relativePath: string): Promise<FileCheck> {
  let patchPlugins;
  try {
    patchPlugins = parsePluginsJs(await readFile(patchFile, "utf8"));
  } catch (error: unknown) {
    return { file: relativePath, ok: false, reason: `patch plugins.js does not parse (${errorMessage(error)})` };
  }
  let gamePlugins;
  try {
    gamePlugins = parsePluginsJs(await readFile(gameFile, "utf8"));
  } catch (error: unknown) {
    return { file: relativePath, ok: false, reason: `game plugins.js does not parse (${errorMessage(error)})` };
  }
  if (patchPlugins.length !== gamePlugins.length) {
    return {
      file: relativePath,
      ok: false,
      reason: `plugin count differs (patch ${patchPlugins.length}, game ${gamePlugins.length})`
    };
  }
  return { file: relativePath, ok: true };
}

// A translation patch only rewrites string values, never the structure, so the
// top-level shape must match the game's: same kind (array vs object), same array
// length, or same set of top-level object keys.
function structureMismatch(patchData: unknown, gameData: unknown): string | undefined {
  const patchIsArray = Array.isArray(patchData);
  const gameIsArray = Array.isArray(gameData);
  if (patchIsArray !== gameIsArray) {
    return "top-level type differs (array vs object)";
  }
  if (patchIsArray && gameIsArray) {
    return patchData.length === gameData.length
      ? undefined
      : `array length differs (patch ${patchData.length}, game ${gameData.length})`;
  }
  if (isObject(patchData) && isObject(gameData)) {
    const patchKeys = Object.keys(patchData).sort();
    const gameKeys = Object.keys(gameData).sort();
    if (patchKeys.length !== gameKeys.length || patchKeys.some((key, index) => key !== gameKeys[index])) {
      return "top-level keys differ from the game file";
    }
  }
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
