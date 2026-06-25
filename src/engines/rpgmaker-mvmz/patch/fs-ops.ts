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

import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathExists, serializeJson, writeFileAtomic, type JsonStyle } from "../../../core/utils/fs.js";
import type { PreparedFile } from "./prepare.js";

const DEFAULT_JSON_STYLE: JsonStyle = { indent: "  ", bom: false, trailingNewline: true, eol: "\n" };

export function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function atomicReplaceFile(sourcePath: string, targetPath: string): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const tempTargetPath = await uniqueSiblingPath(targetPath, "replace");
  await copyFile(sourcePath, tempTargetPath);
  await rename(tempTargetPath, targetPath);
}

export async function createSiblingTempDir(targetPath: string, label: string): Promise<string> {
  const parent = path.dirname(targetPath);
  await mkdir(parent, { recursive: true });
  return mkdtemp(path.join(parent, `.${path.basename(targetPath)}.${label}-`));
}

async function uniqueSiblingPath(targetPath: string, label: string): Promise<string> {
  const parent = path.dirname(targetPath);
  const baseName = path.basename(targetPath);
  let attempt = 0;

  while (true) {
    const candidate = path.join(parent, `.${baseName}.${label}-${timestamp()}-${process.pid}-${attempt}`);
    if (!(await pathExists(candidate))) {
      return candidate;
    }
    attempt += 1;
  }
}

export async function removeIfExists(targetPath: string): Promise<void> {
  await rm(targetPath, { recursive: true, force: true });
}

export async function writePreparedFile(filePath: string, file: PreparedFile): Promise<void> {
  if (file.format === "json") {
    await writeFileAtomic(filePath, serializeJson(file.content, file.style ?? DEFAULT_JSON_STYLE));
    return;
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, String(file.content), "utf8");
}

export async function writeBackupFile(filePath: string, file: PreparedFile): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  // Back up the exact original bytes rather than re-serializing them.
  await writeFile(filePath, await readFile(file.sourcePath, "utf8"), "utf8");
}

// Replace a directory atomically: move the existing one aside, rename the staging
// dir into place, then drop the old one; on failure restore the original.
export async function publishDirectory(stagingDir: string, targetDir: string): Promise<void> {
  await mkdir(path.dirname(targetDir), { recursive: true });
  const rollbackDir = await uniqueSiblingPath(targetDir, "rollback");

  if (!(await pathExists(targetDir))) {
    await rename(stagingDir, targetDir);
    return;
  }

  await rename(targetDir, rollbackDir);
  try {
    await rename(stagingDir, targetDir);
    await removeIfExists(rollbackDir);
  } catch (error: unknown) {
    if (!(await pathExists(targetDir)) && (await pathExists(rollbackDir))) {
      await rename(rollbackDir, targetDir);
    }
    throw error;
  }
}
