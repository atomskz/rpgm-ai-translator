# Changelog

All notable changes to `rpgm-ai-translator` are documented in this file.

## 0.1.5 - 2026-06-23

### Added

- Load defaults from a project config file (`rpgm-ai-translator.json` in the
  working directory, or `--config <file>`). Command-line flags override config
  values, which override built-in defaults. Recognized keys mirror the flag names
  (`provider`, `model`, `target`, `out`, `includePlugins`, `review`, ...).
- Per-command help: `<command> --help` now prints the usage and the flags for
  that specific command, generated from the option schema, instead of a single
  global help block.
- Validate command-line options before running: an unknown flag is rejected with
  a "did you mean" suggestion, a flag missing its value is reported instead of
  swallowing the next token, and a duplicated value option is rejected.
- Print the command usage and a `--help` hint on a usage error, and add
  `--verbose` to additionally print the error stack and full `cause` chain.
- Add `--dry-run` to `apply` and `run` to preview what would be written (files,
  units applied, skipped) without creating or modifying anything.
- Checkpoint each `run` stage (translate, review, repair) as JSONL and resume
  from existing checkpoints, so a crash mid-run no longer discards completed work
  or re-calls the provider for it.
- Write `run` intermediates (units, raw/reviewed/repaired translations, memory,
  report) to a separate work directory (`--work-dir`, default `<out>-work`) so
  the patch folder holds only game files and proprietary memory is not shipped
  with the patch.
- Inject provider configuration and add `--base-url`, so any OpenAI-compatible
  endpoint (including a local one) can be used. Token usage is recorded in a
  provider-neutral `TokenUsage` shape in result metadata and reports.
- Estimate input tokens before calling the provider, aggregate token usage across
  batches into the report, and add `--max-tokens-budget` to stop a run that would
  exceed a token budget.
- Extract MV-style plugin command text (event code 356, gated behind
  `--include-plugins` and the runtime-text safety filter) and Change Name /
  Nickname / Profile operands (codes 320/324/325).
- Add `--dialogue-max-length` to `extract` and `run` to override the per-line
  display-width limit baked into dialogue `maxLength` constraints (default 52),
  since how much text fits on a line depends on the game's message font.

### Changed

- Promote `NUMBER_CHANGED` and `MAX_LINES_EXCEEDED` from warnings to errors so
  the `run`/`apply` validation filter no longer ships translations with altered
  in-game numbers or text that overflows its line budget. `MAX_LENGTH_EXCEEDED`
  remains a warning because horizontal text fitting is still best-effort.
- Apply the shared batch retry to the review, repair and character-inference
  passes, not just the bulk translate pass, so transient provider failures are
  retried consistently. An exhausted review or repair batch now degrades to
  per-unit failures instead of aborting the whole pipeline.
- Make the DeepSeek client the single retry layer, honoring `--retry-attempts`;
  providers retry transient failures internally and return failed results instead
  of throwing, removing the double backoff between the client and the core retry
  wrapper. Authentication and billing errors are never retried.
- Explain all four glossary modes (`keep`, `custom`, `translate`,
  `transliterate`) to the model in the system prompt, and enforce `keep`/`custom`
  in validation while documenting `translate`/`transliterate` as advisory.
- Preserve the original JSON and `plugins.js` serialization when writing patches
  (minified vs pretty, BOM, and the `plugins.js` header/comments), changing only
  the translated strings so a patch diff is limited to the lines that changed.
- Store translation memory as an append-only JSONL log with periodic compaction
  instead of rewriting the whole file on every upsert, and index in-run misses by
  id for O(1) lookup.
- Use a larger default `max_tokens` (32000) for the reasoning review/repair
  passes, since a reasoning model spends `max_tokens` on its chain-of-thought
  before producing an answer; an explicit `--max-tokens` still takes precedence.

### Fixed

- Key translation memory and in-run deduplication on a composite cache key that
  folds in the category, target/source language, layout constraints, context and
  glossary instead of the source string alone. This stops a memory file from returning a
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
- Write the translation memory and generated JSON files (`units.json`,
  `translations.json`, `report.json` and the character glossary) atomically
  (temp file + rename) so a crash mid-write can no longer truncate or wipe them,
  and skip corrupt lines when reading the memory file or a JSONL checkpoint (for
  example a truncated line left by a crash mid-write) so a partially written file
  can still be resumed.
- Refuse a patch `--out` directory that is the game folder, is inside it, or
  contains it, so `apply`/`run` can no longer overwrite the original game without
  a backup.
- Extract Japanese, Chinese and Korean (and fullwidth) database names and
  descriptions and plugin fields; the runtime-text safety filter previously
  required a Latin or Cyrillic letter and silently dropped CJK-only source text.
- Compare in-game numbers on the visible prose only, ignoring digits inside
  control codes and variables (`\C[4]`, `\V[3]`, ...), so reordering or recoloring
  no longer triggers a false `NUMBER_CHANGED`.
- Measure `maxLength` as East Asian display width (full-width CJK counts as two
  cells, a surrogate pair as one glyph of width two) instead of code units, so
  overflowing CJK text is detected.
- Revalidate repaired and reviewed translations and reject a result that
  introduces a validation error which was not already present, keeping the
  previous translation instead of shipping a freshly broken one.
- Harden control-code placeholder protection: tokenize nested codes such as
  `\N[\V[1]]` correctly, tighten the tag pattern so literal `<...>` text and
  comparisons are not mistaken for tags, and restore placeholders in a single
  pass so restore order no longer matters.
- Skip a corrupt or non-standard data file (or an unparseable `plugins.js`) with
  a warning instead of aborting the whole extract or apply, and report the skipped
  files in the result and report.
- Carry JSON paths as structured segment arrays from extraction through apply, so
  plugin and encoded-JSON keys that contain a dot (for example `a.b`) round-trip
  correctly instead of being split and skipped.
- Detect and translate a data-only project (a `data/` folder with no JS runtime)
  by inferring the engine from `System.json` at medium confidence, instead of
  failing as an unknown engine.
- Validate `--mode` against `patch`/`in-place`, warn loudly when `apply` without
  `--units` skips most translations because of an extraction-flag mismatch
  (suggesting `--units`), and warn that `run` ignores `--mode`/`--backup`.
- Stop reporting `UNCHANGED_TRANSLATION` for a translation that is correctly
  identical to its source: a whole-string `keep`-mode glossary term, or text with
  no translatable letters (symbols or digits only).
- Match alphabetic glossary terms on word boundaries so a short term such as `Ko`
  no longer matches inside `Kobold`, while keeping substring matching for CJK
  terms that have no word boundaries.
- Use exponential backoff with jitter and honor a `Retry-After` header on
  rate-limit and unavailable responses, and classify network failures by the
  underlying error code (`ECONNRESET`, `ENOTFOUND`, undici `UND_ERR_*`, ...)
  rather than by matching the error message string.
- Report a clear, actionable error when a provider response is truncated at
  `max_tokens` (`finish_reason: length` with empty or incomplete content),
  telling the user to raise `--max-tokens`, instead of the generic "did not
  include message content". This previously failed the reasoning review/repair
  passes silently when the chain-of-thought consumed the whole token budget.

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
