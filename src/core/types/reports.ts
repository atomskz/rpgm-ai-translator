import type { EngineId } from "./engine.js";
import type { ValidationIssue } from "./validation.js";

export type TranslationReport = {
  engine: EngineId;
  filesScanned: number;
  unitsExtracted: number;
  unitsTranslated: number;
  fromMemory: number;
  failed: number;
  issuesByCode: Record<string, number>;
  issuesByFile: Record<string, number>;
  issuesByCategory: Record<string, number>;
  validationIssues: ValidationIssue[];
  // Non-fatal extraction/apply warnings, e.g. a data file that was skipped
  // because it could not be parsed. Omitted when there are none.
  warnings?: string[];
};
