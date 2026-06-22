import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
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
import { pathExists, readJsonFile, writeJsonFile } from "../utils/fs.js";

type PreparedFile = {
  relativeFilePath: string;
  sourcePath: string;
  content: unknown;
  format: "json" | "text";
  unitsApplied: number;
  skipped: number;
};

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

function isInsideDirectory(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

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
  if (options.mode === "patch") {
    assertPatchOutputOutsideGame(projectPath, options.outDir ?? "");
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
    try {
      const preparedFile = relativeFilePath.endsWith("js/plugins.js")
        ? await preparePluginsFile(relativeFilePath, sourcePath, entries)
        : await prepareJsonFile(relativeFilePath, sourcePath, entries);

      skipped += preparedFile.skipped;
      if (preparedFile.unitsApplied > 0) {
        files.push(preparedFile);
      }
    } catch {
      // A source file that cannot be read or parsed (e.g. a non-standard
      // plugins.js) is skipped so its translations do not abort the whole patch.
      skipped += entries.length;
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
  const stagingDir = await createSiblingTempDir(outDir, "staging");
  const rollbackDir = await createSiblingTempDir(outDir, "rollback");
  const filesWritten: string[] = [];
  let unitsApplied = 0;

  try {
    for (const file of prepared.files) {
      await writePreparedFile(path.join(stagingDir, file.relativeFilePath), file);
      filesWritten.push(path.join(outDir, file.relativeFilePath));
      unitsApplied += file.unitsApplied;
    }

    await publishPatchFiles(stagingDir, rollbackDir, outDir, prepared.files);
  } finally {
    await removeIfExists(stagingDir);
    await removeIfExists(rollbackDir);
  }

  return {
    mode: "patch",
    filesWritten,
    unitsApplied,
    skipped
  };
}

type PatchWriteRecord = {
  relativeFilePath: string;
  existed: boolean;
};

async function publishPatchFiles(
  stagingDir: string,
  rollbackDir: string,
  outDir: string,
  files: PreparedFile[]
): Promise<void> {
  const published: PatchWriteRecord[] = [];

  try {
    for (const file of files) {
      const relativeFilePath = file.relativeFilePath;
      const sourcePath = path.join(stagingDir, relativeFilePath);
      const targetPath = path.join(outDir, relativeFilePath);
      const rollbackPath = path.join(rollbackDir, relativeFilePath);
      const existed = await pathExists(targetPath);

      if (existed) {
        await mkdir(path.dirname(rollbackPath), { recursive: true });
        await copyFile(targetPath, rollbackPath);
      }

      await atomicReplaceFile(sourcePath, targetPath);
      published.push({ relativeFilePath, existed });
    }
  } catch (error: unknown) {
    await rollbackPatchFiles(rollbackDir, outDir, published);
    throw error;
  }
}

async function rollbackPatchFiles(
  rollbackDir: string,
  outDir: string,
  published: PatchWriteRecord[]
): Promise<void> {
  for (const record of published.reverse()) {
    const targetPath = path.join(outDir, record.relativeFilePath);
    if (record.existed) {
      await atomicReplaceFile(path.join(rollbackDir, record.relativeFilePath), targetPath);
    } else {
      await rm(targetPath, { force: true });
    }
  }
}

async function writeInPlaceFiles(
  root: string,
  prepared: { files: PreparedFile[]; skipped: number },
  options: ApplyOptions
): Promise<ApplyResult> {
  const backupDir = path.resolve(options.backupDir ?? path.join(root, `.rpgm-ai-translator-backup-${timestamp()}`));
  const stagingDir = await createSiblingTempDir(root, "staging");
  const backupStagingDir = await createSiblingTempDir(backupDir, "backup");
  const filesWritten: string[] = [];
  let unitsApplied = 0;

  try {
    for (const file of prepared.files) {
      await writePreparedFile(path.join(stagingDir, file.relativeFilePath), file);
      await writeBackupFile(path.join(backupStagingDir, file.relativeFilePath), file);
    }

    await publishDirectory(backupStagingDir, backupDir);

    const replaced: PreparedFile[] = [];
    try {
      for (const file of prepared.files) {
        await atomicReplaceFile(path.join(stagingDir, file.relativeFilePath), file.sourcePath);
        replaced.push(file);
        filesWritten.push(file.sourcePath);
        unitsApplied += file.unitsApplied;
      }
    } catch (error: unknown) {
      await restoreInPlaceFiles(backupDir, replaced);
      throw error;
    }
  } finally {
    await removeIfExists(stagingDir);
    await removeIfExists(backupStagingDir);
  }

  return {
    mode: "in-place",
    filesWritten,
    unitsApplied,
    skipped: prepared.skipped,
    backupDir
  };
}

async function publishDirectory(stagingDir: string, targetDir: string): Promise<void> {
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

async function atomicReplaceFile(sourcePath: string, targetPath: string): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const tempTargetPath = await uniqueSiblingPath(targetPath, "replace");
  await copyFile(sourcePath, tempTargetPath);
  await rename(tempTargetPath, targetPath);
}

async function restoreInPlaceFiles(backupDir: string, replaced: PreparedFile[]): Promise<void> {
  for (const file of replaced.reverse()) {
    await atomicReplaceFile(path.join(backupDir, file.relativeFilePath), file.sourcePath);
  }
}

async function createSiblingTempDir(targetPath: string, label: string): Promise<string> {
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

async function removeIfExists(targetPath: string): Promise<void> {
  await rm(targetPath, { recursive: true, force: true });
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
