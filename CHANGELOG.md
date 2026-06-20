# Changelog

All notable changes to `rpgm-ai-translator` are documented in this file.

## Unreleased

### Changed

- Update DeepSeek examples and default model to `deepseek-v4-flash`; DeepSeek
  translate and character inference requests disable thinking, while review
  requests enable thinking.
- Add DeepSeek `temperature` and `max_tokens` request settings with CLI options
  `--temperature` and `--max-tokens`.
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
