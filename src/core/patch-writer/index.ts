import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ApplyOptions, ApplyResult, TranslationResult, TranslationUnit } from "../types.js";
import { restorePlaceholders } from "../placeholders/index.js";
import {
  getPluginParameter,
  parsePluginsJs,
  serializePluginsJs,
  setPluginParameter
} from "../plugins/index.js";
import { getJsonPath, setJsonPath } from "../utils/json-path.js";
import { readJsonFile, writeJsonFile } from "../utils/fs.js";

type PreparedFile = {
  relativeFilePath: string;
  sourcePath: string;
  content: unknown;
  format: "json" | "text";
  unitsApplied: number;
  skipped: number;
};

export async function writePatch(
  projectPath: string,
  units: TranslationUnit[],
  translations: TranslationResult[],
  options: ApplyOptions
): Promise<ApplyResult> {
  if (options.mode !== "patch" && options.mode !== "in-place") {
    throw new Error(`Patch writer supports patch and in-place modes, got '${options.mode}'`);
  }
  if (options.mode === "patch" && !options.outDir) {
    throw new Error("Patch mode requires options.outDir");
  }

  const root = path.resolve(projectPath);
  const prepared = await prepareFiles(root, units, translations);

  if (options.mode === "patch") {
    return writePatchFiles(prepared, path.resolve(options.outDir ?? ""), prepared.skipped);
  }

  return writeInPlaceFiles(root, prepared, options);
}

async function prepareFiles(
  root: string,
  units: TranslationUnit[],
  translations: TranslationResult[]
): Promise<{ files: PreparedFile[]; skipped: number }> {
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  const translatedByFile = new Map<string, Array<{ unit: TranslationUnit; result: TranslationResult }>>();
  let skipped = 0;

  for (const result of translations) {
    const unit = unitsById.get(result.id);
    if (!unit || result.status !== "translated" || result.translation.trim().length === 0) {
      skipped += 1;
      continue;
    }

    const bucket = translatedByFile.get(unit.filePath) ?? [];
    bucket.push({ unit, result });
    translatedByFile.set(unit.filePath, bucket);
  }

  const files: PreparedFile[] = [];
  for (const [relativeFilePath, entries] of translatedByFile.entries()) {
    const sourcePath = path.join(root, relativeFilePath);
    const preparedFile = relativeFilePath.endsWith("js/plugins.js")
      ? await preparePluginsFile(relativeFilePath, sourcePath, entries)
      : await prepareJsonFile(relativeFilePath, sourcePath, entries);

    skipped += preparedFile.skipped;
    if (preparedFile.unitsApplied > 0) {
      files.push(preparedFile);
    }
  }

  return { files, skipped };
}

async function prepareJsonFile(
  relativeFilePath: string,
  sourcePath: string,
  entries: Array<{ unit: TranslationUnit; result: TranslationResult }>
): Promise<PreparedFile> {
  const data = await readJsonFile(sourcePath);
  let unitsApplied = 0;
  let skipped = 0;

  for (const { unit, result } of entries) {
    const currentValue = getJsonPath(data, unit.jsonPath);
    if (currentSourceValue(currentValue, unit) !== unit.source) {
      skipped += 1;
      continue;
    }
    setJsonPath(data, unit.jsonPath, encodeTranslation(unit, currentValue, restorePlaceholders(result.translation, unit.placeholders)));
    unitsApplied += 1;
  }

  return {
    relativeFilePath,
    sourcePath,
    content: data,
    format: "json",
    unitsApplied,
    skipped
  };
}

async function preparePluginsFile(
  relativeFilePath: string,
  sourcePath: string,
  entries: Array<{ unit: TranslationUnit; result: TranslationResult }>
): Promise<PreparedFile> {
  const plugins = parsePluginsJs(await readFile(sourcePath, "utf8"));
  let unitsApplied = 0;
  let skipped = 0;

  for (const { unit, result } of entries) {
    const currentValue = getPluginParameter(plugins, unit.jsonPath);
    if (currentSourceValue(currentValue, unit) !== unit.source) {
      skipped += 1;
      continue;
    }
    setPluginParameter(plugins, unit.jsonPath, encodeTranslation(unit, currentValue, restorePlaceholders(result.translation, unit.placeholders)));
    unitsApplied += 1;
  }

  return {
    relativeFilePath,
    sourcePath,
    content: serializePluginsJs(plugins),
    format: "text",
    unitsApplied,
    skipped
  };
}

async function writePatchFiles(
  prepared: { files: PreparedFile[]; skipped: number },
  outDir: string,
  skipped: number
): Promise<ApplyResult> {
  await mkdir(outDir, { recursive: true });
  const filesWritten: string[] = [];
  let unitsApplied = 0;

  for (const file of prepared.files) {
    const outputPath = path.join(outDir, file.relativeFilePath);
    await writePreparedFile(outputPath, file);
    filesWritten.push(outputPath);
    unitsApplied += file.unitsApplied;
  }

  return {
    mode: "patch",
    filesWritten,
    unitsApplied,
    skipped
  };
}

async function writeInPlaceFiles(
  root: string,
  prepared: { files: PreparedFile[]; skipped: number },
  options: ApplyOptions
): Promise<ApplyResult> {
  const backupDir = path.resolve(options.backupDir ?? path.join(root, `.rpgm-ai-translator-backup-${timestamp()}`));
  const filesWritten: string[] = [];
  let unitsApplied = 0;

  for (const file of prepared.files) {
    await writeBackupFile(path.join(backupDir, file.relativeFilePath), file);
  }

  for (const file of prepared.files) {
    await writePreparedFile(file.sourcePath, file);
    filesWritten.push(file.sourcePath);
    unitsApplied += file.unitsApplied;
  }

  return {
    mode: "in-place",
    filesWritten,
    unitsApplied,
    skipped: prepared.skipped,
    backupDir
  };
}

async function writePreparedFile(filePath: string, file: PreparedFile): Promise<void> {
  if (file.format === "json") {
    await writeJsonFile(filePath, file.content);
    return;
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, String(file.content), "utf8");
}

async function writeBackupFile(filePath: string, file: PreparedFile): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  if (file.format === "json") {
    await writeJsonFile(filePath, await readJsonFile(file.sourcePath));
    return;
  }

  await writeFile(filePath, await readFile(file.sourcePath, "utf8"), "utf8");
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function currentSourceValue(currentValue: unknown, unit: TranslationUnit): string | undefined {
  if (unit.constraints?.sourceEncoding === "json-string-literal") {
    return currentValue === JSON.stringify(unit.source) ? unit.source : undefined;
  }

  if (unit.constraints?.sourceEncoding === "json-stringified-json") {
    if (typeof currentValue !== "string" || !unit.constraints.encodedJsonPath) {
      return undefined;
    }
    const parsed = parseEncodedJson(currentValue);
    const nestedValue = parsed == null ? undefined : getJsonPath(parsed, unit.constraints.encodedJsonPath);
    return typeof nestedValue === "string" ? nestedValue : undefined;
  }

  return typeof currentValue === "string" ? currentValue : undefined;
}

function encodeTranslation(unit: TranslationUnit, currentValue: unknown, translation: string): string {
  if (unit.constraints?.sourceEncoding === "json-string-literal") {
    return JSON.stringify(translation);
  }

  if (unit.constraints?.sourceEncoding === "json-stringified-json") {
    if (typeof currentValue !== "string" || !unit.constraints.encodedJsonPath) {
      throw new Error(`Cannot encode JSON-stringified translation for '${unit.id}'`);
    }
    const parsed = parseEncodedJson(currentValue);
    if (parsed == null) {
      throw new Error(`Invalid JSON-stringified source for '${unit.id}'`);
    }
    setJsonPath(parsed, unit.constraints.encodedJsonPath, translation);
    return JSON.stringify(parsed);
  }

  return translation;
}

function parseEncodedJson(raw: string): unknown | undefined {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}
