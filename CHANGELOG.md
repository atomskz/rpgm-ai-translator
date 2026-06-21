# Changelog

All notable changes to `rpgm-ai-translator` are documented in this file.

## Unreleased

### Fixed

- Key translation memory and in-run deduplication on a composite cache key that
  folds in the target/source language, layout constraints, context and glossary
  instead of the source string alone. This stops a memory file from returning a
  previous language's translations after switching `--target`, and stops two
  units that merely share a source string but have different constraints or
  context from collapsing onto a single translation. Memory entries now also
  record `cacheKey` and `targetLanguage`; older entries fall back to the source
  hash and are simply re-translated.
- Measure `maxLength`/`maxLines` against the restored translation rather than the
  placeholder-token form, so constrained UI text (choices, name input, plugin
  choices) is checked against the characters the engine actually renders instead
  of the `<PH_n>` tokens.
- Protect the `\$` (gold window), `\<`/`\^` (instant-print / skip-wait) and `\\`
  (escaped backslash) RPG Maker control codes as placeholders so the model can
  no longer drop or alter them and validation can detect changes to them.
- Reconcile DeepSeek response ids against the requested batch: keep the first
  translation for a duplicated id instead of silently using the last, and surface
  unexpected or duplicate ids as a `PROVIDER_RESPONSE_SCHEMA_ERROR` warning
  instead of dropping them without trace.
- Write the translation memory, `units.json` and `translations.json` atomically
  (temp file + rename) so a crash mid-write can no longer truncate or wipe them,
  and tolerate a corrupt final line when reading the memory file or a JSONL
  checkpoint so a partially written file can still be resumed.

### Changed

- Promote `NUMBER_CHANGED` and `MAX_LINES_EXCEEDED` from warnings to errors so
  the `run`/`apply` validation filter no longer ships translations with altered
  in-game numbers or text that overflows its line budget. `MAX_LENGTH_EXCEEDED`
  remains a warning because horizontal text fitting is still best-effort.

## 0.1.4 - 2026-06-21

### Changed

- Split the DeepSeek provider into focused client, error mapping, schema parsing,
  result mapping, defaults, and public provider modules.
- Centralize repeated CLI option parsing into shared provider, extraction, apply,
  and font option helpers.
- Split the core domain types into focused engine, glossary, translation,
  validation, options, reports, and interface modules while preserving the
  existing `core/types` public export.
- Split translation memory into JSONL storage, memory-aware pipeline, and
  translation retry modules, and centralize shared batch sizing helpers.
- Make patch and in-place writes stage files before publishing, with rollback
  for existing patch outputs and partially applied in-place writes.
- Split the prompt builder into focused system prompt, glossary filtering,
  translation, review, and character inference modules while keeping the
  existing provider export surface.
- Split validator checks into focused id/status, placeholder, token, constraint,
  and glossary rule modules while keeping `DefaultValidator` as the coordinator.
- Split the broad CLI test suite into command-focused help, translate,
  validate/repair, apply/font, and review/characters suites with shared fixtures.

## 0.1.3 - 2026-06-20

### Changed

- Update DeepSeek examples and default model to `deepseek-v4-flash`; DeepSeek
  translate and character inference requests disable thinking, while review
  requests enable thinking.
- Add DeepSeek `temperature` and `max_tokens` request settings with CLI options
  `--temperature` and `--max-tokens`.
- Map DeepSeek provider failures to specific report codes for authentication,
  billing, rate limits, timeouts, network failures, server failures, request
  errors, response errors, and response schema errors.
- Type `TranslationResult.metadata` and provider usage metadata while preserving
  compatibility with additional metadata keys in imported translation files.
- Split the RPG Maker MV/MZ extractor internals into database, event, plugin,
  encoded JSON, and shared helper modules.

## 0.1.2 - 2026-06-20

### Added

- Preserve imported translation `issues` and `metadata` when reading JSON and
  JSONL translation files.
- Add issue summaries by code, file, and category to generated reports.
- Add `apply --units` to apply translations with the exact extracted units from
  a manual pipeline.
- Add JSONL checkpoint writing and reuse for `review` and `repair`.
- Add `repair --attempts` with revalidation between attempts for stubborn issues
  such as `MAX_LENGTH_EXCEEDED`.

## 0.1.1 - 2026-06-19

### Added

- Write translation JSONL checkpoints after each completed batch and resume from
  an explicit `--checkpoint` file.

### Fixed

- Preserve RPG Maker Show Text speaker names by default so portrait plugins that
  use speaker names as lookup keys do not break after translation.
- Protect custom plugin escape codes such as `\MPD[Surprise]` as control-code
  placeholders.

## 0.1.0 - 2026-06-19

### Added

- CLI pipeline for RPG Maker MV/MZ project detection, extraction, translation,
  validation, patch writing, and report generation.
- RPG Maker MV/MZ JSON extractor for database files, map events, common events,
  selected Control Variables string literals, selected plugin command text, and
  selected JSON-encoded plugin text fields.
- Placeholder protection for RPG Maker control codes, variables, percent tokens,
  tags, and brace tokens.
- DeepSeek provider through the OpenAI-compatible Chat Completions API.
- Mock provider for tests and dry runs.
- JSONL translation memory with cached reads and batched writes.
- Glossary support and glossary validation.
- Character glossary generation plus review pass for dialogue and choices.
- Targeted repair pass for validation issues, including `run --repair`.
- Safe patch output, optional in-place mode with backup, and optional RPG Maker MZ
  font patching.
- Synthetic asset-free MZ sample under `examples/mz-sample`.
- GitHub Actions CI and npm package smoke check.

### Known Limitations

- Plugin extraction is conservative and will still miss some plugin-specific
  payload formats.
- Text fitting is best-effort; too-long translations should be checked through
  validation reports and repaired or edited when needed.
- Character gender and style inference is heuristic and should be manually
  reviewed in `characters.json`.
- VX Ace, VX, XP, GUI, OCR, screenshot review, and cloud backend support are out
  of scope for this release.
