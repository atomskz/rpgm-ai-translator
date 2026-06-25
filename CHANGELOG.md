# Changelog

All notable changes to `rpgm-ai-translator` are documented in this file.

## Unreleased

### Added

- Echo the resolved target language (`Target language: <code>`) on every
  translating command (`translate`, `characters`, `review`, `repair`, `run`),
  marking it `(default)` when it fell back to the built-in `ru`. `run`
  additionally prints a warning when no `--target` (or config `target`) was
  given, so a forgotten flag is caught before a full paid patch ships in the
  wrong language instead of being discovered by playing the game. The notice goes
  to stderr, so a piped stdout payload is unaffected.
- Accept `--repair-codes` and `--repair-attempts` as aliases for `--codes` and
  `--attempts` in the standalone `repair` command (mirroring `run`), so the
  `repairCodes`/`repairAttempts` project-config keys — which inject under the
  `--repair-*` names — now reach `repair` instead of being silently dropped. An
  explicit `--codes`/`--attempts` on the command line still takes precedence over
  config, and the config-to-argv merge now folds a flag and its alias to one
  canonical form so the two spellings can never collide as a duplicate option.

### Internal

- Add a byte-for-byte golden test of the patch writer's output — indentation, BOM,
  CRLF/LF line endings, trailing newline, minified files, and the `plugins.js`
  header and array round-trip — so any future change that reshapes a shipped patch
  fails the test suite.

### Changed

- `apply` (patch mode) and `run` now refuse to write into a non-empty output
  directory by default and accept a new `--force` flag to override. Patch mode
  writes only the changed files, so overlaying a fresh patch onto a stale one (or
  an unrelated directory) silently mixed two generations; refusing avoids that.
  `run` still freely overwrites an `--out` it produced for the same game, so the
  normal resume/re-run workflow is unaffected; pointing it at a different game's
  output requires `--force` (which then resets the shared work directory).

### Fixed

- Persist how many repair attempts a `run --repair` already completed so resuming
  an interrupted run continues the `--repair-attempts` budget instead of restarting
  at attempt 1 — which could spend (and bill) well past the requested cap. The
  counter is reset when a run starts fresh and cleared on a clean finish, so a
  later deliberate re-run still gets the full budget.
- Serialize patch writes with a per-directory lock so two concurrent `apply`/`run`
  invocations can no longer interleave their staged writes and rollbacks into the
  same patch output directory (or, for in-place mode, the same game directory) and
  leave a half-written result. `apply` previously took no lock at all and `run`
  locked only its work directory, not the patch output. The lock is held only for
  the write and removed afterwards, so it is never shipped inside a patch.
- Widen the resumable run signature and the translation-memory key so they cover
  every setting that shapes output, not only language/model/provider/glossary.
  Changing `--temperature`, `--max-tokens`, `--batch-size`, or any extraction flag
  (`--include-plugins`, `--include-speaker-names`, `--include-comments`,
  `--dialogue-max-length`) and re-running now discards the stale checkpoints —
  and is a translation-memory miss for the sampling change — instead of silently
  resuming output produced under the previous settings. A run that does not pass
  these settings keeps the same key, so its existing memory stays valid.
- Isolate runs by source game so two different games translated into the same
  `--out` (and therefore the same default work directory) no longer share
  checkpoints or translation memory. The resumable run signature now includes a
  game identity (resolved project path and engine); pointing `--out` at a work
  directory last used for a different game discards that game's checkpoints and
  its default translation memory and starts fresh, instead of silently resuming
  the previous game's output. Re-running the same game (including after a
  language/model change) is unaffected, and an explicit `--memory` you chose to
  share is never deleted.

## 0.1.7 - 2026-06-25

### Changed

- Expose the package as a typed entry point (`main`/`types`/`exports` →
  `dist/index`), stop shipping source maps that pointed at the unpublished `src/`
  tree, and run `typecheck`/`lint`/`test` on `prepublishOnly`.
- Exit non-zero on a partial result so a wrapping script or agent does not treat it
  as a clean success: `run` and `repair` exit `2` when a translation they produced
  still fails validation after repair (a unit the provider merely failed to deliver
  does not, on its own, trigger this — that is reflected in the report and the
  no-output exit `1`); `apply` without `--units` exits `1` when an id mismatch skipped
  at least half of its translations; and `review` exits `1` when every batch failed
  and nothing was reviewed.

### Internal

- Reorganized `src/` into a hexagonal (ports-and-adapters) layout: `core` holds the
  domain and the `LLMProvider`/`Extractor`/`EngineDetector` ports, while
  `engines/rpgmaker-mvmz`, `providers`, and `config` are adapters that depend only on
  `core`, and `cli` is the composition root. Each multi-file module is sealed behind a
  `public-api.ts` facade, and the dependency direction and facade rule are enforced by
  eslint so a boundary violation fails `lint` and CI. No public API or runtime
  behavior changed. See [docs/architecture.md](docs/architecture.md).
- Added v8 test coverage (`npm run coverage`) with a CI-enforced floor in
  `vitest.config.ts`, plus tests for previously-uncovered failure-recovery paths: the
  patch writer's rollback on a partial patch and its in-place restore from backup, a
  non-`Error` provider rejection, and the DeepSeek review and character-inference
  response handling.

### Fixed

- Font-patch the correct engine and layout instead of silently no-opping. `patch-font`
  now detects the engine (and a deployed `www/` layout): RPG Maker MZ writes the
  `System.json` `advanced` font fields as before, while RPG Maker MV rewrites
  `fonts/gamefont.css` (the `GameFont` face) — previously MV copied the font file but
  had no effect, and a `www/`-layout game failed to find `System.json`. An
  unrecognized project is now refused with a clear error.
- Re-validate that an in-place target still resolves inside the project immediately
  before each write, so a directory symlink swapped into the path after the initial
  read-time check cannot redirect an in-place write out of the project (TOCTOU).
- Cap the number of glossary entries injected into a single translation or review
  batch (keeping the most specific terms and warning when trimming), so a large
  glossary matching many common terms can no longer inflate the prompt and crowd out
  the translation payload.
- Distinguish an `apply` skip caused by an id/source mismatch from a translation
  that was simply not produced (failed or empty): the "ids did not match" warning
  and the non-zero exit on a majority skip now fire only on real mismatches, so
  applying a partially-translated set no longer trips the flag-mismatch warning or a
  spurious exit `1`.
- Count a unit a provider omits from a review/repair response as a failure rather
  than letting it disappear into the skipped tally. The unit keeps its previous
  translation and is left out of the checkpoint so a resume re-requests it (the
  bundled providers already report missing ids; this hardens the shared path for a
  custom provider that returns a short list).
- Reject a review/repair result that breaks a different token of an error code it
  already had (for example fixing one missing placeholder while dropping another):
  the regression gate now compares each error by code and message — which names the
  specific token — instead of merely by whether the code was already present, so a
  freshly-broken translation can no longer slip through with an unchanged error count.
- Recognize asset references that contain spaces or backslash separators (for
  example `img\face 1.png`) as non-translatable, so they are no longer extracted as
  translatable strings.
- Reject an in-place `--backup` directory anywhere inside the game folder (the
  project root, its `data`/`js` folders, or any other subfolder such as `img`) as
  well as one that contains it, so the backup's rename-swap cannot clobber the very
  files it is meant to preserve. The default hidden backup directory is unaffected.
- Guard the `--max-tokens-budget` before each character-inference batch (projected
  against the tokens already spent by translate/review/repair) instead of after the
  provider call, so an over-budget inference fails before spending rather than after.
- Reject a `custom`-mode glossary term that has no translation when the glossary is
  loaded, instead of sending the model the contradictory instruction to "use the
  provided translation exactly" with none provided.
- Bound the evidence sent to the character-inference pass (cap the snippets per
  candidate and truncate long ones) so a heavily-quoted character cannot inflate the
  prompt past the context window and waste a truncated response.
- Coerce a missing `currentTranslation` when filtering the glossary for a review
  batch, so a hand-edited or checkpoint-sourced review unit without it no longer
  throws while the batch messages are built.
- Reject `__proto__`, `constructor` and `prototype` as JSON-path or plugin-parameter
  segments when applying a patch, so a crafted `units.json` cannot turn the path
  writers into a prototype-pollution primitive. Such a unit is skipped instead of
  written.
- Measure `maxLength` per line (the widest rendered line) instead of across the
  whole string, so a translation legitimately wrapped over several lines is no
  longer reported as `MAX_LENGTH_EXCEEDED` for its summed width.
- Discard a checkpoint whose signature file is present but unparseable or missing
  fields, instead of resuming it as "no information". A truly absent signature (an
  older work directory) is still resumed for backward compatibility, but a
  half-written or tampered signature no longer lets a checkpoint of unknown
  provenance ship potentially mismatched output.
- Reconcile provider response ids on the review and repair passes: a result whose
  id was not requested in the batch, or that duplicates one already processed, is
  dropped instead of inflating the failure count and writing a duplicate checkpoint
  line that would replay on resume (the translate pass already did this).
- Carry `--include-comments` (and `--dialogue-max-length`) translations through to
  the patch. `run` now writes the patch from the units it already extracted instead
  of re-extracting with a narrower flag set, and standalone `apply` (without
  `--units`) accepts `--include-comments`/`--dialogue-max-length` so the re-extracted
  ids match. Previously a `run --include-comments` translated event comments but
  silently dropped them at apply as id mismatches.

## 0.1.6 - 2026-06-24

### Added

- Lock the work directory for the duration of a `run` (a `.rpgm-run.lock` file)
  so two runs sharing a `--work-dir` cannot interleave checkpoint and memory
  writes and corrupt them. The lock is released on `SIGINT`/`SIGTERM`, and a lock
  left behind by a dead process is reclaimed automatically on the next run.
- Honor `--max-tokens-budget` during the `characters` pass, not only the
  translate, review and repair passes.
- Accept `--codes` and `--attempts` as aliases for `--repair-codes` and
  `--repair-attempts` in the `run` command, so the repair flag names work in both
  commands.
- Version the validation report (`schemaVersion`) and record a units fingerprint,
  so `repair` warns when the report was generated from a different extraction and
  an unrecognized report version is rejected with a clear message.
- Accept the global `--verbose` and `--config` flags before the subcommand
  (`rpgm-ai-translator --verbose translate …`), not only after it, so a leading
  flag is no longer reported as "Unknown command".

### Changed

- Exit non-zero on failure: `validate` exits `2` when it finds apply-blocking
  errors, and `translate`/`run` exit `1` when no translations are produced, so a
  wrapping script stops instead of proceeding on empty output.
- Require `--out` for `apply`/`run` patch mode as a usage error instead of failing
  deep inside the patch writer with no hint.
- Reject surplus positional arguments and empty or whitespace-only option values
  instead of silently ignoring them; `characters` points to `--translations` when
  a translations file is passed as a second positional.
- Validate a units file's category, placeholders and constraints when it is
  loaded, and validate project-config value types (warning on unknown keys).
- Preserve original line endings (LF/CRLF) when rewriting JSON and `plugins.js`,
  and read positional arguments independently of option order.
- Relicense under GPL-3.0-or-later and add source-file headers.
- Split CI into a Node-version matrix `verify` job and a `package` smoke-test job
  that installs the packed tarball and uploads it as an artifact named by the
  short commit SHA.
- Send only machine-readable JSON to stdout and route progress, batch summaries
  and warnings to stderr, so redirecting stdout (for example `extract … > units.json`)
  captures a clean payload with no human-readable noise mixed in.
- Preserve a hand-edited `plugins.js`'s array indentation (2 or 4 spaces, or tabs)
  when rewriting it, changing only the translated strings.
- Estimate the `--max-tokens-budget` before the review and repair passes too
  (against the tokens already spent), not only before translate, so an over-budget
  run fails before a pass starts instead of mid-batch with tokens wasted.
- Narrow the public API surface: drop the unused `AppConfig`/`defaultConfig`
  exports, keep the prompt payload builders internal, and stop writing a write-only
  `.meta.json` beside a derived (non-`--checkpoint`) checkpoint.

### Fixed

- Reject a unit file path that escapes the project or output directory before any
  file is written.
- Discard a `review`/`repair` checkpoint written for a different target language,
  model, provider or glossary instead of resuming it and mixing stale output into
  the patch (the `translate`/`run` guard now also covers the standalone passes).
- Count a batch's token usage once instead of once per unit, so
  `--max-tokens-budget` and the report total are no longer multiplied by the batch
  size.
- Stop reporting a prose comparison (`HP < 50 and MP > 20`) as a
  `TECHNICAL_TOKEN_CHANGED`, recognize `\$`/`\^`/`\<`/`\\` consistently with the
  placeholder protector, and treat a leading-zero-less decimal (`.5` vs `0.5`) as
  unchanged.
- Warn on any `apply` skip caused by an id mismatch (not only at 50% or more) and
  print a human-readable summary instead of the raw result JSON.
- Surface provider failure reasons in batch progress output, disambiguate
  encoded-JSON unit ids when object keys contain dots, and match half-width
  katakana glossary terms.
- Round-trip JSON paths losslessly: keep an empty-string object key, and
  distinguish a numeric object key (`{"0": ...}`) from an array index so two
  neighbouring values no longer collapse onto the same unit id.
- Stop sending `temperature` on the reasoning review/repair passes (thinking
  enabled), where `deepseek-reasoner` rejected it with a non-retryable 400 and
  DeepSeek V4 ignored it anyway.
- Make `apply`/`run` patch skips visible and harden writing: report why a file was
  skipped (unreadable, unparseable, or resolving outside the project via a symlink)
  instead of only counting it; parse a `plugins.js` that has code after the
  `$plugins` array; apply a script/control-variable string literal stored in a
  valid but non-canonical form (escaped solidus, `\uXXXX`); and reject a unit file
  that resolves outside the project through a symlink.

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
