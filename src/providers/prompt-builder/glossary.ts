import type { Glossary, ReviewUnit, TranslationUnit } from "../../core/types.js";

export function filterGlossaryForBatch(glossary: Glossary | undefined, batch: TranslationUnit[]): Glossary {
  if (!glossary) {
    return {};
  }

  const relevant: Glossary = {};
  for (const [term, entry] of Object.entries(glossary)) {
    if (batch.some((unit) => unit.source.includes(term) || unit.normalizedSource?.includes(term))) {
      relevant[term] = entry;
    }
  }
  return relevant;
}

export function filterGlossaryForReviewBatch(glossary: Glossary | undefined, batch: ReviewUnit[]): Glossary {
  if (!glossary) {
    return {};
  }

  const relevant: Glossary = {};
  for (const [term, entry] of Object.entries(glossary)) {
    if (
      batch.some(
        (unit) =>
          unit.source.includes(term) ||
          unit.normalizedSource?.includes(term) ||
          unit.currentTranslation.includes(term)
      )
    ) {
      relevant[term] = entry;
    }
  }
  return relevant;
}
