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

export function getJsonPath(root: unknown, jsonPath: string): unknown {
  return getJsonPathSegments(root, parseJsonPath(jsonPath));
}

export function setJsonPath(root: unknown, jsonPath: string, newValue: unknown): void {
  setJsonPathSegments(root, parseJsonPath(jsonPath), newValue);
}

// Traverse by explicit segments so a key containing a literal `.` is honored as a
// single segment instead of being split by `parseJsonPath`.
export function getJsonPathSegments(root: unknown, segments: string[]): unknown {
  return segments.reduce((value: unknown, segment) => {
    if (value == null) {
      return undefined;
    }
    return (value as Record<string, unknown>)[segment];
  }, root);
}

export function setJsonPathSegments(root: unknown, segments: string[], newValue: unknown): void {
  if (segments.length === 0) {
    throw new Error("Cannot set an empty JSON path");
  }

  let cursor = root as Record<string, unknown>;
  for (const segment of segments.slice(0, -1)) {
    const next = cursor[segment];
    if (next == null || typeof next !== "object") {
      throw new Error(`Cannot traverse JSON path segment '${segment}'`);
    }
    cursor = next as Record<string, unknown>;
  }

  cursor[segments[segments.length - 1]] = newValue;
}

export function parseJsonPath(jsonPath: string): string[] {
  return jsonPath.split(".").filter(Boolean);
}
