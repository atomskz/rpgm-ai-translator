import type {
  CharacterCandidate,
  CharacterGlossary,
  LLMProvider,
  CharacterInferenceOptions,
  TranslationResult,
  TranslationUnit
} from "../types.js";
import { normalizeBatchSize } from "../batching/index.js";

export type CharacterExtractionOptions = {
  includeDialogueMentions?: boolean;
  evidenceLimit?: number;
};

const DEFAULT_EVIDENCE_LIMIT = 8;

export function extractCharacterCandidates(
  units: TranslationUnit[],
  translations: TranslationResult[] = [],
  options: CharacterExtractionOptions = {}
): CharacterCandidate[] {
  const evidenceLimit = options.evidenceLimit ?? DEFAULT_EVIDENCE_LIMIT;
  const byId = new Map(translations.map((translation) => [translation.id, translation]));
  const candidates = new Map<string, CharacterCandidate>();

  for (const unit of units) {
    const translation = byId.get(unit.id);
    if (unit.id.match(/^Actors\.\d+\.name$/)) {
      addCandidate(candidates, unit.source, "actor", unit, translation, evidenceLimit);
    }

    if (unit.category === "dialogue" || unit.category === "choice") {
      if (unit.context?.speaker) {
        addCandidate(candidates, unit.context.speaker, "speaker", unit, translation, evidenceLimit);
      }
      if (unit.context?.eventName) {
        addCandidate(candidates, unit.context.eventName, "event", unit, translation, evidenceLimit);
      }
      if (options.includeDialogueMentions) {
        for (const mention of extractNameMentions(unit.source)) {
          addCandidate(candidates, mention, "dialogue-mention", unit, translation, evidenceLimit);
        }
      }
    }
  }

  return Array.from(candidates.values())
    .filter(
      (candidate) =>
        candidate.sources.includes("actor") ||
        candidate.sources.includes("speaker") ||
        (candidate.sources.includes("dialogue-mention") && candidate.occurrences > 1)
    )
    .sort((left, right) => {
      const priority = scoreCandidate(right) - scoreCandidate(left);
      return priority !== 0 ? priority : left.name.localeCompare(right.name);
    });
}

export async function inferCharacterGlossary(
  candidates: CharacterCandidate[],
  provider: LLMProvider,
  options: CharacterInferenceOptions
): Promise<CharacterGlossary> {
  const batchSize = normalizeBatchSize(options.batchSize);
  const glossary: CharacterGlossary = {};

  for (let index = 0; index < candidates.length; index += batchSize) {
    const batch = candidates.slice(index, index + batchSize);
    try {
      Object.assign(glossary, await provider.inferCharacters(batch, options));
    } catch (error: unknown) {
      Object.assign(glossary, markBatchForManualReview(batch, error));
    }
  }

  return glossary;
}

function markBatchForManualReview(candidates: CharacterCandidate[], error: unknown): CharacterGlossary {
  const message = error instanceof Error ? error.message : String(error);
  const draft = candidatesToDraftGlossary(candidates);
  for (const entry of Object.values(draft)) {
    entry.confidence = 0;
    entry.review = true;
    entry.description = `${entry.description ?? ""} Character inference failed: ${message}`.trim();
  }
  return draft;
}

export function candidatesToDraftGlossary(candidates: CharacterCandidate[]): CharacterGlossary {
  return Object.fromEntries(
    candidates.map((candidate) => [
      candidate.name,
      {
        translation: candidate.suggestedTranslation,
        gender: "unknown" as const,
        type: candidate.sources.includes("actor") || candidate.sources.includes("speaker") ? ("person" as const) : ("unknown" as const),
        description: summarizeEvidence(candidate),
        confidence: candidate.sources.includes("actor") || candidate.sources.includes("speaker") ? 0.5 : 0.25,
        review: true
      }
    ])
  );
}

function addCandidate(
  candidates: Map<string, CharacterCandidate>,
  rawName: string,
  sourceType: CharacterCandidate["sources"][number],
  unit: TranslationUnit,
  translation: TranslationResult | undefined,
  evidenceLimit: number
): void {
  const name = normalizeName(rawName);
  if (!isLikelyCharacterName(name)) {
    return;
  }

  const existing = candidates.get(name) ?? {
    name,
    suggestedTranslation: undefined,
    sources: [],
    occurrences: 0,
    evidence: []
  };

  if (!existing.sources.includes(sourceType)) {
    existing.sources.push(sourceType);
  }
  existing.occurrences += 1;
  existing.suggestedTranslation ??= sourceType === "actor" || unit.category === "name" ? translation?.translation : undefined;
  if (existing.evidence.length < evidenceLimit) {
    existing.evidence.push({
      unitId: unit.id,
      category: unit.category,
      source: unit.source,
      translation: translation?.translation,
      context: unit.context
    });
  }
  candidates.set(name, existing);
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function isLikelyCharacterName(name: string): boolean {
  if (name.length < 2 || name.length > 48) {
    return false;
  }
  if (!/[A-Za-zА-Яа-яЁёぁ-んァ-ン一-龯]/.test(name)) {
    return false;
  }
  if (/^[A-Z]{2,}[_\d-]*$/.test(name) || /^\d+$/.test(name)) {
    return false;
  }
  if (/(chest|door|switch|lever|treasure|monster|enemy|event|ev\d+|sound|battle|map|quest|save|load|menu|auto|recover)/i.test(name)) {
    return false;
  }
  if (/[\\/{}[\]<>]/.test(name)) {
    return false;
  }
  return true;
}

function extractNameMentions(source: string): string[] {
  return Array.from(new Set(source.match(/\b[A-Z][A-Za-z'-]{2,}(?:\s+[A-Z][A-Za-z'-]{2,})?\b/g) ?? [])).filter(
    isLikelyCharacterName
  );
}

function scoreCandidate(candidate: CharacterCandidate): number {
  return (
    candidate.occurrences +
    (candidate.sources.includes("actor") ? 100 : 0) +
    (candidate.sources.includes("speaker") ? 50 : 0) +
    (candidate.sources.includes("event") ? 5 : 0)
  );
}

function summarizeEvidence(candidate: CharacterCandidate): string {
  const sourceTypes = candidate.sources.join(", ");
  return `Auto-extracted candidate from ${sourceTypes}; occurrences: ${candidate.occurrences}.`;
}
