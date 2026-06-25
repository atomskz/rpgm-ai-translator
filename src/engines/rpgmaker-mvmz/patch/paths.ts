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

import { realpath } from "node:fs/promises";
import path from "node:path";

// Patch mode must never write into the original game folder, because patch mode
// does not create a backup. Reject an output directory that is the game folder
// itself or is nested in (or contains) it, before any files are read or written.
export function assertPatchOutputOutsideGame(projectPath: string, outDir: string): void {
  const root = path.resolve(projectPath);
  const resolvedOut = path.resolve(outDir);
  if (resolvedOut === root || isInsideDirectory(root, resolvedOut) || isInsideDirectory(resolvedOut, root)) {
    throw new Error(
      `Output directory must be outside the game folder to avoid overwriting it (game: '${projectPath}', out: '${outDir}')`
    );
  }
}

export function isInsideDirectory(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

// In-place mode publishes the backup directory with a rename-swap, so an explicit
// --backup-dir must live entirely outside the game folder: being the root, sitting
// anywhere inside it (e.g. an art subfolder), or containing it would let the swap
// clobber the very files the backup is meant to preserve. Mirrors the patch-mode
// --out guard. The default backup (a dedicated hidden dir inside the root) never
// passes through here, so it is unaffected.
export function assertBackupDirSafe(root: string, backupDir: string): void {
  const resolved = path.resolve(backupDir);
  if (resolved === root || isInsideDirectory(root, resolved) || isInsideDirectory(resolved, root)) {
    throw new Error(`Backup directory must be outside the game folder ('${backupDir}')`);
  }
}

// Reject a unit file path that is absolute or escapes the root via `..`. The same
// relative path is joined to the game dir, the output/staging dir and the backup
// dir, so validating it once at intake confines every read and write. A
// units.json from an untrusted or shared source could otherwise read or overwrite
// files outside the patch directory (and, in-place, anywhere on disk).
export function assertSafeRelativePath(relativeFilePath: string): void {
  const normalized = path.normalize(relativeFilePath);
  if (path.isAbsolute(normalized) || normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`Unsafe unit file path '${relativeFilePath}': must be a relative path inside the project`);
  }
}

// Re-validate that a target still resolves inside the project immediately before an
// in-place write. The read-time realpath check can be defeated by a symlink swapped
// into a path component afterwards (TOCTOU); re-resolving here narrows that window so
// the write cannot follow a freshly-planted directory symlink out of the project.
export async function assertResolvesInsideProject(realRoot: string, targetPath: string): Promise<void> {
  let realTarget: string;
  try {
    realTarget = await realpath(targetPath);
  } catch {
    throw new Error(`'${targetPath}' could not be resolved before writing in place`);
  }
  if (realTarget !== realRoot && !isInsideDirectory(realRoot, realTarget)) {
    throw new Error(`'${targetPath}' resolves outside the project directory via a symlink`);
  }
}
