export function getJsonPath(root: unknown, jsonPath: string): unknown {
  return parseJsonPath(jsonPath).reduce((value: unknown, segment) => {
    if (value == null) {
      return undefined;
    }
    return (value as Record<string, unknown>)[segment];
  }, root);
}

export function setJsonPath(root: unknown, jsonPath: string, newValue: unknown): void {
  const segments = parseJsonPath(jsonPath);
  if (segments.length === 0) {
    throw new Error("Cannot set an empty JSON path");
  }

  let cursor = root as Record<string, unknown>;
  for (const segment of segments.slice(0, -1)) {
    const next = cursor[segment];
    if (next == null || typeof next !== "object") {
      throw new Error(`Cannot traverse JSON path segment '${segment}' in '${jsonPath}'`);
    }
    cursor = next as Record<string, unknown>;
  }

  cursor[segments[segments.length - 1]] = newValue;
}

export function parseJsonPath(jsonPath: string): string[] {
  return jsonPath.split(".").filter(Boolean);
}
