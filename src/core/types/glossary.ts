import type { TranslationCategory, TranslationUnit } from "./translation.js";

export type GlossaryMode = "keep" | "translate" | "transliterate" | "custom";

export type Glossary = Record<
  string,
  {
    translation?: string;
    mode: GlossaryMode;
  }
>;

export type CharacterGender = "male" | "female" | "neutral" | "unknown";

export type CharacterKind = "person" | "place" | "group" | "creature" | "object" | "unknown";

export type CharacterGlossary = Record<
  string,
  {
    gender?: CharacterGender;
    type?: CharacterKind;
    translation?: string;
    aliases?: string[];
    description?: string;
    speechStyle?: string;
    confidence?: number;
    review?: boolean;
  }
>;

export type CharacterCandidate = {
  name: string;
  suggestedTranslation?: string;
  sources: Array<"actor" | "speaker" | "event" | "dialogue-mention">;
  occurrences: number;
  evidence: Array<{
    unitId: string;
    category: TranslationCategory;
    source: string;
    translation?: string;
    context?: TranslationUnit["context"];
  }>;
};
