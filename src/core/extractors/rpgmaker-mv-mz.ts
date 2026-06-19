import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type {
  ApplyOptions,
  ApplyResult,
  EngineId,
  ExtractOptions,
  Extractor,
  TranslationCategory,
  TranslationResult,
  TranslationUnit
} from "../types.js";
import { MvMzEngineDetector } from "../engine-detector/index.js";
import { protectPlaceholders } from "../placeholders/index.js";
import {
  isSafeTranslatablePluginParameter,
  parsePluginsJs,
  pluginParameterPath
} from "../plugins/index.js";
import { writePatch } from "../patch-writer/index.js";
import { hashSource } from "../utils/hash.js";
import { readJsonFile, toPosixPath } from "../utils/fs.js";

type JsonObject = Record<string, unknown>;

type UnitDraft = {
  source: string;
  absoluteFilePath: string;
  relativeFilePath: string;
  jsonPath: string;
  engine: EngineId;
  category: TranslationCategory;
  context?: TranslationUnit["context"];
  constraints?: TranslationUnit["constraints"];
};

export class RpgMakerMvMzExtractor implements Extractor {
  constructor(private readonly detector = new MvMzEngineDetector()) {}

  async extract(projectPath: string, options: ExtractOptions = {}): Promise<TranslationUnit[]> {
    const detected = await this.detector.detect(projectPath);
    if (!detected.dataPath || detected.engine === "unknown") {
      throw new Error(`Unsupported or unknown RPG Maker engine for '${path.resolve(projectPath)}'`);
    }
    const dataPath = detected.dataPath;
    const engine = detected.engine;
    const entries = await readdir(dataPath, { withFileTypes: true });
    const jsonFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(dataPath, entry.name))
      .sort();

    const units: TranslationUnit[] = [];
    for (const filePath of jsonFiles) {
      const fileName = path.basename(filePath);
      const data = await readJsonFile(filePath);
      const relativeFilePath = toPosixPath(path.relative(detected.projectPath, filePath));
      const drafts = extractFromKnownFile(fileName, data, {
        absoluteFilePath: filePath,
        relativeFilePath,
        engine,
        extractOptions: options
      });
      units.push(...drafts.map(toTranslationUnit));
    }

    if (options.includePlugins && detected.pluginsPath) {
      const relativeFilePath = toPosixPath(path.relative(detected.projectPath, detected.pluginsPath));
      units.push(
        ...extractPluginsJs(await readFile(detected.pluginsPath, "utf8"), {
          absoluteFilePath: detected.pluginsPath,
          relativeFilePath,
          engine
        }).map(toTranslationUnit)
      );
    }

    return units;
  }

  async applyTranslations(
    projectPath: string,
    translations: TranslationResult[],
    options: ApplyOptions
  ): Promise<ApplyResult> {
    if (options.mode !== "patch" && options.mode !== "in-place") {
      throw new Error(`Apply mode '${options.mode}' is not implemented in the MVP`);
    }

    const units = await this.extract(projectPath, { includePlugins: options.includePlugins });
    return writePatch(projectPath, units, translations, options);
  }
}

function extractFromKnownFile(
  fileName: string,
  data: unknown,
  base: Pick<UnitDraft, "absoluteFilePath" | "relativeFilePath" | "engine"> & {
    extractOptions: ExtractOptions;
  }
): UnitDraft[] {
  if (Array.isArray(data)) {
    return extractArrayFile(fileName, data, base);
  }

  if (isObject(data) && fileName === "System.json") {
    return extractSystem(data, base);
  }

  if (isObject(data) && /^Map\d+\.json$/.test(fileName)) {
    return extractMap(data, base);
  }

  return [];
}

function extractArrayFile(
  fileName: string,
  rows: unknown[],
  base: Pick<UnitDraft, "absoluteFilePath" | "relativeFilePath" | "engine"> & {
    extractOptions: ExtractOptions;
  }
): UnitDraft[] {
  const units: UnitDraft[] = [];
  const fields = getArrayFileFields(fileName);

  if (fileName === "CommonEvents.json") {
    rows.forEach((row, rowIndex) => {
      if (!isObject(row)) {
        return;
      }
      units.push(
        ...extractEventCommandList(row.list, {
          ...base,
          prefix: `${rowIndex}.list`,
          context: { eventId: numberOrUndefined(row.id), eventName: stringOrUndefined(row.name) },
          includeComments: base.extractOptions.includeEventComments ?? false
        })
      );
    });
    return units;
  }

  for (const [rowIndex, row] of rows.entries()) {
    if (!isObject(row)) {
      continue;
    }

    for (const field of fields) {
      const source = row[field.name];
      if (isTranslatableString(source) && isSafeRuntimeText(source)) {
        units.push(
          makeDraft(base, `${rowIndex}.${field.name}`, source, field.category, {
            eventId: numberOrUndefined(row.id),
            eventName: stringOrUndefined(row.name)
          })
        );
      }
    }
  }

  return units;
}

function getArrayFileFields(fileName: string): Array<{ name: string; category: TranslationCategory }> {
  switch (fileName) {
    case "Actors.json":
      return [
        { name: "name", category: "name" },
        { name: "nickname", category: "name" },
        { name: "profile", category: "description" }
      ];
    case "Classes.json":
      return [
        { name: "name", category: "name" },
        { name: "description", category: "description" }
      ];
    case "Skills.json":
      return [
        { name: "name", category: "name" },
        { name: "description", category: "description" },
        { name: "message1", category: "system" },
        { name: "message2", category: "system" }
      ];
    case "Items.json":
    case "Weapons.json":
    case "Armors.json":
      return [
        { name: "name", category: "name" },
        { name: "description", category: "description" }
      ];
    case "Enemies.json":
      return [{ name: "name", category: "name" }];
    case "States.json":
      return [
        { name: "name", category: "name" },
        { name: "message1", category: "system" },
        { name: "message2", category: "system" },
        { name: "message3", category: "system" },
        { name: "message4", category: "system" }
      ];
    case "MapInfos.json":
      return [{ name: "name", category: "name" }];
    default:
      return [];
  }
}

function extractSystem(
  data: JsonObject,
  base: Pick<UnitDraft, "absoluteFilePath" | "relativeFilePath" | "engine">
): UnitDraft[] {
  const units: UnitDraft[] = [];
  const directFields = ["gameTitle", "currencyUnit"] as const;
  for (const field of directFields) {
    const source = data[field];
    if (isTranslatableString(source)) {
      units.push(makeDraft(base, field, source, "system"));
    }
  }

  const arrayFields = ["armorTypes", "elements", "equipTypes", "skillTypes", "weaponTypes"] as const;
  for (const field of arrayFields) {
    const value = data[field];
    if (!Array.isArray(value)) {
      continue;
    }
    value.forEach((source, index) => {
      if (index > 0 && isTranslatableString(source)) {
        units.push(makeDraft(base, `${field}.${index}`, source, "system"));
      }
    });
  }

  for (const field of ["terms"] as const) {
    const value = data[field];
    if (isObject(value)) {
      units.push(...extractNestedStrings(value, field, base, "system"));
    }
  }

  return units;
}

function extractMap(
  data: JsonObject,
  base: Pick<UnitDraft, "absoluteFilePath" | "relativeFilePath" | "engine"> & {
    extractOptions: ExtractOptions;
  }
): UnitDraft[] {
  const units: UnitDraft[] = [];
  const mapName = stringOrUndefined(data.displayName);

  if (isTranslatableString(data.displayName)) {
    units.push(makeDraft(base, "displayName", data.displayName, "name", { mapName }));
  }

  const events = data.events;
  if (!Array.isArray(events)) {
    return units;
  }

  events.forEach((event, eventIndex) => {
    if (!isObject(event)) {
      return;
    }
    const eventContext = {
      mapName,
      eventId: numberOrUndefined(event.id),
      eventName: stringOrUndefined(event.name)
    };
    const pages = event.pages;
    if (!Array.isArray(pages)) {
      return;
    }
    pages.forEach((page, pageIndex) => {
      if (!isObject(page)) {
        return;
      }
      units.push(
        ...extractEventCommandList(page.list, {
          ...base,
          prefix: `events.${eventIndex}.pages.${pageIndex}.list`,
          context: eventContext,
          includeComments: base.extractOptions.includeEventComments ?? false
        })
      );
    });
  });

  return units;
}

function extractEventCommandList(
  list: unknown,
  options: Pick<UnitDraft, "absoluteFilePath" | "relativeFilePath" | "engine"> & {
    prefix: string;
    context?: TranslationUnit["context"];
    includeComments: boolean;
  }
): UnitDraft[] {
  if (!Array.isArray(list)) {
    return [];
  }

  const units: UnitDraft[] = [];

  let currentSpeaker = options.context?.speaker;

  list.forEach((command, commandIndex) => {
    if (!isObject(command) || !Array.isArray(command.parameters)) {
      return;
    }

    const code = command.code;
    const speakerParameter = command.parameters[4];
    if (code === 101 && isTranslatableString(speakerParameter)) {
      currentSpeaker = speakerParameter;
      units.push(
        makeDraft(
          options,
          `${options.prefix}.${commandIndex}.parameters.4`,
          speakerParameter,
          "name",
          {
            ...options.context,
            speaker: currentSpeaker,
            ...neighborContext(list, commandIndex)
          },
          { maxLines: 1, maxLength: 24 }
        )
      );
    }

    const textParameter = command.parameters[0];
    if ((code === 401 || code === 405) && isTranslatableString(textParameter)) {
      units.push(
        makeDraft(
          options,
          `${options.prefix}.${commandIndex}.parameters.0`,
          textParameter,
          "dialogue",
          {
            ...options.context,
            speaker: currentSpeaker,
            ...neighborContext(list, commandIndex)
          },
          { maxLines: 1, maxLength: 52 }
        )
      );
    }

    if (code === 102 && Array.isArray(textParameter)) {
      textParameter.forEach((choice, choiceIndex) => {
        if (isTranslatableString(choice)) {
          units.push(
            makeDraft(
              options,
              `${options.prefix}.${commandIndex}.parameters.0.${choiceIndex}`,
              choice,
              "choice",
              {
                ...options.context,
                ...neighborContext(list, commandIndex)
              },
              { maxLines: 1, maxLength: 28 }
            )
          );
        }
      });
    }

    const variableScriptValue = command.parameters[4];
    if (code === 122 && command.parameters[3] === 4 && typeof variableScriptValue === "string") {
      const source = decodeScriptStringLiteral(variableScriptValue);
      if (isTranslatableString(source)) {
        units.push(
          makeDraft(
            options,
            `${options.prefix}.${commandIndex}.parameters.4`,
            source,
            "system",
            {
              ...options.context,
              speaker: currentSpeaker,
              ...neighborContext(list, commandIndex)
            },
            { maxLines: 1, maxLength: 54, sourceEncoding: "json-string-literal" }
          )
        );
      }
    }

    const pluginCommandArgs = command.parameters[3];
    if (code === 357 && isObject(pluginCommandArgs)) {
      units.push(
        ...extractPluginCommandText(pluginCommandArgs, {
          ...options,
          prefix: `${options.prefix}.${commandIndex}.parameters.3`,
          context: {
            ...options.context,
            speaker: currentSpeaker,
            ...neighborContext(list, commandIndex)
          }
        })
      );
    }

    if (options.includeComments && (code === 108 || code === 408) && isTranslatableString(textParameter)) {
      units.push(
        makeDraft(options, `${options.prefix}.${commandIndex}.parameters.0`, textParameter, "unknown", {
          ...options.context,
          ...neighborContext(list, commandIndex)
        })
      );
    }
  });

  return units;
}

function extractPluginCommandText(
  args: JsonObject,
  options: Pick<UnitDraft, "absoluteFilePath" | "relativeFilePath" | "engine"> & {
    prefix: string;
    context?: TranslationUnit["context"];
  }
): UnitDraft[] {
  const units: UnitDraft[] = [];
  const safeTextKeys = new Set(["messageText", "helpText", "description", "displayText"]);

  for (const [key, value] of Object.entries(args)) {
    if (safeTextKeys.has(key) && isTranslatableString(value) && isSafeRuntimeText(value)) {
      units.push(
        makeDraft(options, `${options.prefix}.${key}`, value, "system", options.context, {
          maxLines: 1,
          maxLength: 48
        })
      );
      continue;
    }

    if (typeof value === "string") {
      units.push(
        ...extractEncodedJsonStrings(value, `${options.prefix}.${key}`, options, "system", {
          maxLines: 1,
          maxLength: 48
        })
      );
    }
  }

  return units;
}

function extractEncodedJsonStrings(
  raw: string,
  outerJsonPath: string,
  base: Pick<UnitDraft, "absoluteFilePath" | "relativeFilePath" | "engine"> & {
    context?: TranslationUnit["context"];
  },
  category: TranslationCategory,
  constraints: TranslationUnit["constraints"]
): UnitDraft[] {
  const parsed = parseJsonString(raw);
  if (parsed == null) {
    return [];
  }

  const units: UnitDraft[] = [];
  visitEncodedJsonStrings(parsed, "", (encodedJsonPath, key, source) => {
    if (!isSafeEncodedJsonTextKey(key) || !isSafeRuntimeText(source)) {
      return;
    }
    units.push(
      makeDraft(base, outerJsonPath, source, category, base.context, {
        ...constraints,
        sourceEncoding: "json-stringified-json",
        encodedJsonPath
      })
    );
  });
  return units;
}

function visitEncodedJsonStrings(
  value: unknown,
  pathPrefix: string,
  visit: (jsonPath: string, key: string, value: string) => void
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitEncodedJsonStrings(item, joinJsonPath(pathPrefix, String(index)), visit));
    return;
  }

  if (!isObject(value)) {
    return;
  }

  for (const [key, item] of Object.entries(value)) {
    const jsonPath = joinJsonPath(pathPrefix, key);
    if (typeof item === "string") {
      visit(jsonPath, key, item);
    } else {
      visitEncodedJsonStrings(item, jsonPath, visit);
    }
  }
}

function neighborContext(list: unknown[], commandIndex: number): Pick<NonNullable<TranslationUnit["context"]>, "previousLines" | "nextLines"> {
  return {
    previousLines: collectNeighborLines(list, commandIndex, -1),
    nextLines: collectNeighborLines(list, commandIndex, 1)
  };
}

function collectNeighborLines(list: unknown[], commandIndex: number, direction: -1 | 1, limit = 2): string[] {
  const lines: string[] = [];
  for (let index = commandIndex + direction; index >= 0 && index < list.length && lines.length < limit; index += direction) {
    const text = eventCommandText(list[index]);
    if (text) {
      lines.push(text);
    }
  }
  return direction === -1 ? lines.reverse() : lines;
}

function eventCommandText(command: unknown): string | undefined {
  if (!isObject(command) || !Array.isArray(command.parameters)) {
    return undefined;
  }

  const code = command.code;
  const firstParameter = command.parameters[0];
  if ((code === 401 || code === 405 || code === 108 || code === 408) && isTranslatableString(firstParameter)) {
    return firstParameter;
  }

  if (code === 102 && Array.isArray(firstParameter)) {
    return firstParameter.filter(isTranslatableString).join(" / ") || undefined;
  }

  const variableScriptValue = command.parameters[4];
  if (code === 122 && command.parameters[3] === 4 && typeof variableScriptValue === "string") {
    return decodeScriptStringLiteral(variableScriptValue);
  }

  const pluginCommandArgs = command.parameters[3];
  if (code === 357 && isObject(pluginCommandArgs) && isTranslatableString(pluginCommandArgs.messageText)) {
    return pluginCommandArgs.messageText;
  }

  return undefined;
}

function extractNestedStrings(
  value: unknown,
  prefix: string,
  base: Pick<UnitDraft, "absoluteFilePath" | "relativeFilePath" | "engine">,
  category: TranslationCategory
): UnitDraft[] {
  if (isTranslatableString(value)) {
    return [makeDraft(base, prefix, value, category)];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => extractNestedStrings(item, `${prefix}.${index}`, base, category));
  }

  if (isObject(value)) {
    return Object.entries(value).flatMap(([key, item]) => extractNestedStrings(item, `${prefix}.${key}`, base, category));
  }

  return [];
}

function extractPluginsJs(
  raw: string,
  base: Pick<UnitDraft, "absoluteFilePath" | "relativeFilePath" | "engine">
): UnitDraft[] {
  const plugins = parsePluginsJs(raw);
  const units: UnitDraft[] = [];

  plugins.forEach((plugin, pluginIndex) => {
    if (!plugin?.status || !plugin.parameters) {
      return;
    }

    for (const [key, source] of Object.entries(plugin.parameters)) {
      if (typeof source === "string" && isSafeTranslatablePluginParameter(key, source)) {
        units.push(
          makeDraft(
            base,
            pluginParameterPath(pluginIndex, key),
            source,
            "plugin-parameter",
            { eventName: plugin.name }
          )
        );
        continue;
      }

      if (typeof source === "string") {
        units.push(
          ...extractEncodedJsonStrings(
            source,
            pluginParameterPath(pluginIndex, key),
            {
              ...base,
              context: { eventName: plugin.name }
            },
            "plugin-parameter",
            { maxLines: 1, maxLength: 48 }
          )
        );
      }
    }
  });

  return units;
}

function makeDraft(
  base: Pick<UnitDraft, "absoluteFilePath" | "relativeFilePath" | "engine">,
  jsonPath: string,
  source: string,
  category: TranslationCategory,
  context?: TranslationUnit["context"],
  constraints: TranslationUnit["constraints"] = {}
): UnitDraft {
  return {
    ...base,
    source,
    jsonPath,
    category,
    context,
    constraints: {
      preserveControlCodes: true,
      preserveNewlines: source.includes("\n"),
      maxLines: source.includes("\n") ? source.split(/\r?\n/).length : constraints.maxLines,
      ...constraints
    }
  };
}

function toTranslationUnit(draft: UnitDraft): TranslationUnit {
  const protectedText = protectPlaceholders(draft.source);
  const encodedJsonSuffix =
    draft.constraints?.sourceEncoding === "json-stringified-json" && draft.constraints.encodedJsonPath
      ? `.$json.${draft.constraints.encodedJsonPath}`
      : "";
  return {
    id: `${path.basename(draft.relativeFilePath, path.extname(draft.relativeFilePath))}.${draft.jsonPath}${encodedJsonSuffix}`,
    source: draft.source,
    normalizedSource: protectedText.text,
    filePath: draft.relativeFilePath,
    jsonPath: draft.jsonPath,
    engine: draft.engine,
    category: draft.category,
    context: draft.context,
    constraints: draft.constraints,
    placeholders: protectedText.placeholders,
    hash: hashSource(draft.source)
  };
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function isTranslatableString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseJsonString(raw: string): unknown | undefined {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function joinJsonPath(prefix: string, segment: string): string {
  return prefix ? `${prefix}.${segment}` : segment;
}

function isSafeEncodedJsonTextKey(key: string): boolean {
  return /^(?:text|label|messageText|helpText|description|displayText|caption|title|commandName|itemName|optionName)$/i.test(key);
}

function decodeScriptStringLiteral(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isSafeRuntimeText(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (/^\$game[A-Za-z]+\./.test(trimmed) || /^(?:true|false|null)$/i.test(trimmed)) {
    return false;
  }
  if (/^[\w./-]+\.(?:png|jpg|jpeg|webp|ogg|m4a|mp3|wav)$/i.test(trimmed)) {
    return false;
  }
  return /[A-Za-zА-Яа-яЁё]/.test(trimmed);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
