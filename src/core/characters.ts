/*
 * This file is part of rpgm-ai-translator.
 *
 * Copyright (C) 2026 Nikita Fedorov
 *
 * rpgm-ai-translator is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * rpgm-ai-translator is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with rpgm-ai-translator. If not, see <https://www.gnu.org/licenses/>.
 */

import type {
  CharacterCandidate,
  CharacterGlossary,
  LLMProvider,
  CharacterInferenceOptions,
  TranslationResult,
  TranslationUnit
} from "./types/types.js";
import { normalizeBatchSize } from "./batching.js";
import type { TokenBudget } from "./cost.js";
import { isRetryableProviderError, withProviderRetry } from "./retry.js";

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
  options: CharacterInferenceOptions,
  budget?: TokenBudget
): Promise<CharacterGlossary> {
  const batchSize = normalizeBatchSize(options.batchSize);
  const glossary: CharacterGlossary = {};
  // The provider degrades to a review draft instead of surfacing token usage, so
  // charge the budget a per-batch estimate and abort once the cumulative estimate
  // passes the limit — mirroring how translate guards each batch against
  // --max-tokens-budget rather than letting this pass spend without bound.
  let estimatedTokens = 0;

  for (let index = 0; index < candidates.length; index += batchSize) {
    const batch = candidates.slice(index, index + batchSize);
    // Guard the batch before spending on it, projected against the tokens already
    // spent by earlier passes (translate/review/repair), so an over-budget pass
    // fails before the provider call instead of after — matching review/repair.
    if (budget) {
      estimatedTokens += estimateCandidateTokens(batch);
      budget.assertProjectedWithin(estimatedTokens);
    }
    let response: CharacterGlossary;
    try {
      response = await withProviderRetry(() => provider.inferCharacters(batch, options), {
        retryAttempts: options.retryAttempts,
        retryDelayMs: options.retryDelayMs,
        isRetryable: isRetryableProviderError
      });
    } catch (error: unknown) {
      response = markBatchForManualReview(batch, error);
    }
    mergePreferringConfidence(glossary, reconcileBatch(batch, response, options.onWarning));
  }

  return glossary;
}

// Rough per-candidate token estimate (the provider does not report usage for
// inference). Mirrors the cost module's ~4-chars-per-token plus fixed per-item
// overhead heuristic so the character pass is bounded by the same budget guard.
const CHARS_PER_TOKEN = 4;
const OVERHEAD_TOKENS_PER_CANDIDATE = 16;

function estimateCandidateTokens(candidates: CharacterCandidate[]): number {
  let characters = 0;
  for (const candidate of candidates) {
    characters += candidate.name.length + (candidate.suggestedTranslation?.length ?? 0);
    for (const evidence of candidate.evidence) {
      characters += evidence.source.length + (evidence.translation?.length ?? 0);
    }
  }
  return Math.ceil(characters / CHARS_PER_TOKEN) + candidates.length * OVERHEAD_TOKENS_PER_CANDIDATE;
}

// Reconcile a batch's response against the requested candidates: drop entries
// the model invented for names we did not ask about, and turn names it dropped
// into review drafts so a candidate is never silently lost. Mismatches are
// surfaced as a single warning. The result is keyed exactly by the batch names.
function reconcileBatch(
  batch: CharacterCandidate[],
  response: CharacterGlossary,
  onWarning: ((message: string) => void) | undefined
): CharacterGlossary {
  const requested = new Set(batch.map((candidate) => candidate.name));
  const reconciled: CharacterGlossary = {};
  const unexpected: string[] = [];
  for (const [name, entry] of Object.entries(response)) {
    if (requested.has(name)) {
      reconciled[name] = entry;
    } else {
      unexpected.push(name);
    }
  }
  const missing = batch.filter((candidate) => !(candidate.name in response));
  if (missing.length > 0) {
    Object.assign(reconciled, markMissingForReview(missing));
  }
  if (onWarning && (missing.length > 0 || unexpected.length > 0)) {
    const parts: string[] = [];
    if (missing.length > 0) {
      parts.push(`omitted ${missing.length} requested name(s): ${missing.map((candidate) => candidate.name).join(", ")}`);
    }
    if (unexpected.length > 0) {
      parts.push(`returned ${unexpected.length} unrequested name(s): ${unexpected.join(", ")}`);
    }
    onWarning(`Character inference response did not match the requested candidates — ${parts.join("; ")}.`);
  }
  return reconciled;
}

// Accumulate batch results, keeping the higher-confidence entry when the same
// name appears more than once so a later, less certain batch never clobbers an
// earlier, more confident one.
function mergePreferringConfidence(glossary: CharacterGlossary, additions: CharacterGlossary): void {
  for (const [name, entry] of Object.entries(additions)) {
    const existing = glossary[name];
    if (!existing || (entry.confidence ?? 0) > (existing.confidence ?? 0)) {
      glossary[name] = entry;
    }
  }
}

function markMissingForReview(candidates: CharacterCandidate[]): CharacterGlossary {
  const draft = candidatesToDraftGlossary(candidates);
  for (const entry of Object.values(draft)) {
    entry.review = true;
    entry.description = `${entry.description ?? ""} Model did not return this candidate; left for manual review.`.trim();
  }
  return draft;
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
