import { JsonlTranslationMemory, translateWithMemory } from "../../core/memory/index.js";
import { createReport } from "../../core/reports/index.js";
import {
  appendTranslationResultsJsonlFile,
  readTranslationResultsJsonlFile,
  readTranslationUnitsFile,
  resetTranslationResultsJsonlFile,
  writeTranslationResultsFile
} from "../../core/translation-units/index.js";
import { loadGlossary } from "../../config/index.js";
import { createProvider } from "../../providers/index.js";
import {
  checkpointedTranslationsById,
  defaultCheckpointPath,
  missingCheckpointResult
} from "../checkpoints.js";
import { maybeWriteReport } from "../file-utils.js";
import {
  assertProviderReady,
  readOption,
  readProviderName,
  readTranslateCliOptions,
  requireArg
} from "../options.js";
import { createProgressLogger } from "../progress.js";
import type { CliIO } from "../types.js";

export async function translateCommand(args: string[], io: CliIO): Promise<number> {
  const unitsPath = requireArg(args[0], "units path");
  const providerName = readProviderName(args);
  assertProviderReady(providerName);
  const providerOptions = readTranslateCliOptions(args);
  const out = readOption(args, "--out");
  const checkpointOption = readOption(args, "--checkpoint");
  const reportPath = readOption(args, "--report");
  const memoryPath = readOption(args, "--memory");
  const glossaryPath = readOption(args, "--glossary");
  const units = await readTranslationUnitsFile(unitsPath);
  const glossary = glossaryPath ? await loadGlossary(glossaryPath) : undefined;
  const checkpointPath = checkpointOption ?? (out ? defaultCheckpointPath(out) : undefined);
  const checkpointResults = checkpointOption ? await readTranslationResultsJsonlFile(checkpointOption) : [];
  const checkpointById = checkpointedTranslationsById(units, checkpointResults);
  const unitsToTranslate = units.filter((unit) => !checkpointById.has(unit.id));
  if (checkpointPath) {
    if (checkpointOption) {
      io.stdout(`Loaded checkpoint: ${checkpointById.size}/${units.length} translated units from ${checkpointPath}\n`);
    } else {
      await resetTranslationResultsJsonlFile(checkpointPath);
    }
    io.stdout(`Writing checkpoint: ${checkpointPath}\n`);
  }
  const provider = createProvider(providerName);
  const translatedResults = await translateWithMemory(
    unitsToTranslate,
    provider,
    {
      ...providerOptions,
      glossary,
      onProgress: createProgressLogger(io),
      onBatchResults: checkpointPath
        ? async (batchResults) => {
            await appendTranslationResultsJsonlFile(checkpointPath, batchResults);
            io.stdout(`Checkpoint saved: ${batchResults.length} results.\n`);
          }
        : undefined
    },
    memoryPath ? new JsonlTranslationMemory(memoryPath) : undefined
  );
  const translatedById = new Map(translatedResults.map((result) => [result.id, result]));
  const results = units.map(
    (unit) =>
      translatedById.get(unit.id) ??
      checkpointById.get(unit.id) ??
      missingCheckpointResult(unit, providerName, providerOptions.model)
  );
  const payload = `${JSON.stringify(results, null, 2)}\n`;
  if (out) {
    await writeTranslationResultsFile(out, results);
  } else {
    io.stdout(payload);
  }
  await maybeWriteReport(reportPath, createReport({ units, translations: results }), io);
  return 0;
}
