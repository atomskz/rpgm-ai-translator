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

import { access, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

let atomicWriteCounter = 0;

/**
 * Writes a file atomically by writing to a uniquely named temp file in the same
 * directory and renaming it into place. A crash mid-write leaves the temp file
 * (cleaned up here on failure) rather than a truncated destination file.
 */
export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  atomicWriteCounter += 1;
  const tempPath = `${filePath}.tmp-${process.pid}-${atomicWriteCounter}`;
  try {
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, filePath);
  } catch (error: unknown) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(targetPath: string): Promise<boolean> {
  try {
    return (await stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

export async function readJsonFile<T = unknown>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export type JsonStyle = {
  // Indent string for pretty printing, or null for minified (single-line) JSON.
  indent: string | null;
  bom: boolean;
  trailingNewline: boolean;
};

// Best-effort detection of how a JSON file was serialized, so a patch can be
// written back in the same shape (minified stays minified, the original indent
// and trailing newline are kept) instead of being reformatted wholesale.
export function detectJsonStyle(raw: string): JsonStyle {
  const bom = raw.charCodeAt(0) === 0xfeff;
  const body = bom ? raw.slice(1) : raw;
  const trailingNewline = /\n\s*$/.test(body);
  const hasStructuralNewline = body.trim().includes("\n");
  const indentMatch = body.match(/\n([ \t]+)\S/);
  const indent = hasStructuralNewline ? indentMatch?.[1] ?? "  " : null;
  return { indent, bom, trailingNewline };
}

const BOM = String.fromCharCode(0xfeff);

export function serializeJson(value: unknown, style: JsonStyle): string {
  const core = style.indent == null ? JSON.stringify(value) : JSON.stringify(value, null, style.indent);
  return `${style.bom ? BOM : ""}${core}${style.trailingNewline ? "\n" : ""}`;
}

export function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join(path.posix.sep);
}
