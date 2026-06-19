import { readFile } from "node:fs/promises";
import type { Glossary, GlossaryMode } from "../core/types.js";

const MODES: GlossaryMode[] = ["keep", "translate", "transliterate", "custom"];

export async function loadGlossary(filePath: string): Promise<Glossary> {
  const raw = await readFile(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    throw new Error(`Invalid glossary JSON in '${filePath}': ${error instanceof Error ? error.message : String(error)}`, {
      cause: error
    });
  }

  if (!isGlossary(parsed)) {
    throw new Error("Glossary must be an object whose values have a valid mode and optional translation string");
  }

  return parsed;
}

function isGlossary(value: unknown): value is Glossary {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => {
    if (typeof entry !== "object" || entry == null || Array.isArray(entry)) {
      return false;
    }
    const candidate = entry as { mode?: unknown; translation?: unknown };
    return (
      typeof candidate.mode === "string" &&
      MODES.includes(candidate.mode as GlossaryMode) &&
      (candidate.translation == null || typeof candidate.translation === "string")
    );
  });
}
