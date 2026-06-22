export type AppConfig = {
  provider?: "deepseek" | "mock";
  targetLanguage: string;
  batchSize: number;
};

export const defaultConfig: AppConfig = {
  provider: "mock",
  targetLanguage: "ru",
  batchSize: 20
};

export * from "./glossary.js";
export * from "./characters.js";
export * from "./project.js";
