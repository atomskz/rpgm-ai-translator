# Changelog

All notable changes to `rpgm-ai-translator` are documented in this file.

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
