# Changelog

All notable changes to `rpgm-ai-translator` are documented in this file.

## Unreleased

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
