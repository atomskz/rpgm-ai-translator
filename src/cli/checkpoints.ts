import type { TranslationResult, TranslationUnit } from "../core/types.js";

export function defaultCheckpointPath(outPath: string): string {
  return outPath.endsWith(".json") ? `${outPath.slice(0, -".json".length)}.jsonl` : `${outPath}.jsonl`;
}

export function checkpointedTranslationsById(
  units: TranslationUnit[],
  checkpointResults: TranslationResult[]
): Map<string, TranslationResult> {
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  const resultsById = new Map<string, TranslationResult>();

  for (const result of checkpointResults) {
    const unit = unitsById.get(result.id);
    if (!unit || result.status !== "translated" || result.source !== unit.source) {
      continue;
    }
    resultsById.set(result.id, { ...result, metadata: { ...result.metadata, fromCheckpoint: true } });
  }

  return resultsById;
}

export function mergeCheckpointTranslations(
  units: TranslationUnit[],
  translations: TranslationResult[],
  checkpointById: Map<string, TranslationResult>
): TranslationResult[] {
  const translationsById = new Map(translations.map((translation) => [translation.id, translation]));
  const unitIds = new Set(units.map((unit) => unit.id));
  const merged = units
    .map((unit) => checkpointById.get(unit.id) ?? translationsById.get(unit.id))
    .filter((translation): translation is TranslationResult => translation != null);
  return merged.concat(translations.filter((translation) => !unitIds.has(translation.id)));
}

export function missingCheckpointResult(
  unit: TranslationUnit,
  providerName: string,
  model: string | undefined
): TranslationResult {
  return {
    id: unit.id,
    source: unit.source,
    translation: "",
    provider: providerName,
    model: model ?? "unknown",
    status: "failed",
    issues: [
      {
        id: unit.id,
        severity: "error",
        code: "MISSING_TRANSLATION",
        message: "Translation was not produced"
      }
    ]
  };
}
