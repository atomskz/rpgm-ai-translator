export type EngineId = "rpgmaker-mv" | "rpgmaker-mz";
export type DetectedEngineId = EngineId | "unknown";

export type DetectedEngine = {
  engine: DetectedEngineId;
  rootPath: string;
  projectPath: string;
  dataPath?: string;
  pluginsPath?: string;
  confidence: "high" | "medium" | "low";
  reasons: string[];
};

export interface EngineDetector {
  detect(projectPath: string): Promise<DetectedEngine>;
}
