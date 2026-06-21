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
};
