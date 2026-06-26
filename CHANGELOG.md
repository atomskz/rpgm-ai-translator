# Changelog

All notable changes to `rpgm-ai-translator` are documented in this file.

## Unreleased

### Internal

- Remove the tag-triggered npm publish workflow (`.github/workflows/release.yml`).
  The project is not published to npm for now; the CI `package` job still builds
  the `.tgz` and uploads it as a build artifact, as before. Distribute a release
  by attaching that tarball to a GitHub Release.

## 0.1.9 - 2026-06-26

### Internal

- Add a tag-triggered release workflow (`.github/workflows/release.yml`) that
  publishes to npm with provenance (a signed public build attestation) when a
  `v*` version tag is pushed. The publish job is gated on the same
  typecheck/lint/coverage/build verify matrix CI runs and refuses to publish if
  the tag does not match `package.json`'s version.
- Add project governance docs: `SECURITY.md` (private vulnerability reporting and
  scope notes), `CONTRIBUTING.md` (dev setup, the validation baseline, and the
  layering/facade rules for adding a command/engine/provider), and GitHub issue
  and pull-request templates under `.github/`.
- Add display-width and number-canonicalization edge tests
  (`tests/display-width.test.ts`): emoji (two cells, once per surrogate pair),
  fullwidth vs halfwidth forms, supplementary-plane CJK, zero-width
  joiner/variation selector, and number canonicalization (grouping vs decimal
  separators, leading-dot decimals, fullwidth digits, percent, ellipsis runs).
- Hoist the per-file database field map out of a switch into one exported
  constant (`DATABASE_ARRAY_FIELDS`), the single source of truth for the
  translatable per-row fields of each array-shaped database file, and add a
  schema-coverage test that asserts each file extracts exactly its mapped fields
  (no more, no fewer), so a dropped or mistyped field fails the suite instead of
  silently dropping its text. No extraction behavior changed.
- Resolve the engine through a registry (`engines/registry.ts`, `detectEngine`)
  instead of constructing the concrete `MvMzEngineDetector`/`RpgMakerMvMzExtractor`
  in every command (`detect`, `extract`, `apply`, `run`, `status`, `doctor`). A
  command now detects and receives the matching adapter (so it gets the right
  extractor without a second lookup); adding an engine becomes a sibling adapter
  registered in one place rather than an edit in each command. Sealed the new
  `providers/openai-chat` module behind the eslint facade rule. No behavior changed.

### Fixed

- Measure a combining diacritical mark (and a few zero-width formatting controls)
  as zero display width, so a decomposed accented letter (`e` + U+0301) counts as
  one cell like its precomposed form. Length validation (`maxLength`) no longer
  over-counts text in combining-diacritic languages and reports spurious
  overflow.
- Refuse an explicit in-place `--backup` directory that is not empty. In-place mode
  publishes the backup with a whole-directory rename-swap, which would discard
  whatever was already in an explicitly named backup directory; it now errors
  instead, telling you to choose an empty or new directory. The default timestamped
  backup is always fresh and so is unaffected.
- Re-check that a patch file's parent directory still resolves inside the output
  directory immediately before writing it, so a directory symlink planted under
  the patch `--out` (a subfolder swapped to point elsewhere) can no longer
  redirect a write — or the pre-write rollback copy — outside the patch directory.
  This mirrors the existing in-place TOCTOU re-check on the patch side.
- Back up an in-place original byte-for-byte with `copyFile` instead of a UTF-8
  string round-trip, so a non-UTF-8 file (for example a legacy Shift-JIS
  `plugins.js`) is preserved exactly and can be restored faithfully, rather than
  having its bytes replaced with the U+FFFD replacement character on backup.
- Name the configured endpoint in provider error messages instead of always
  saying "DeepSeek": a failure against a custom `--base-url` is now labeled by its
  host (for example `localhost:11434 API error 500: …`), so a generic or local
  endpoint's failure is no longer mislabeled as the default provider. The default
  DeepSeek endpoint is still named "DeepSeek".
- Parse a response from a generic OpenAI-compatible endpoint more tolerantly: read
  the answer from the legacy completion `text` field when `message.content` is
  absent, and treat an empty `content` with a non-empty reasoning field as
  budget-exhausting truncation (the same actionable raise-`--max-tokens` guidance
  as an explicit `max_tokens` cut-off) rather than a bare "no content". The strict
  DeepSeek path is unaffected, since DeepSeek sets neither field.

### Added

- Print a one-line ownership/distribution reminder on the commands that produce a
  translated game (`run`, `apply`) — "translate only games you own or have the
  right to modify, and do not redistribute copyrighted assets" — to stderr, so the
  obligation is visible at the point of use, not only in the docs.
- Add a `verify` command (`verify <game> <patch-dir>`) that checks a written patch
  against the game it overlays: it confirms the patch directory is outside the
  game, re-parses each patch JSON / `plugins.js`, and confirms each one
  structurally matches the corresponding game file (same top-level shape, same
  array length / object keys, same plugin count, no orphan files). It exits
  non-zero on any mismatch, so a shipped patch can be checked before distribution.
- Add a `glossary` command. `glossary extract <units.json>` drafts a glossary by
  mining frequently recurring proper nouns from the units (capitalized words that
  never appear lowercased, so a sentence-initial common word is excluded), in
  mode `keep`, as an editable starting point (`--min-occurrences` sets the recur
  threshold, default 2; `--out` or stdout). `glossary check <glossary.json>`
  lints a glossary — structure (naming the offending term), empty term keys and
  case-duplicate terms — exiting non-zero on a problem so a CI check can gate on it.
- Add `--thinking on|off|auto` (config `thinking`) to control DeepSeek reasoning.
  Reasoning is now decided by the model's capability rather than only the pass:
  in the default `auto` mode the review pass reasons only for a reasoning-capable
  model (`deepseek-reasoner` or the hybrid V4 line), so a plain chat model
  (`deepseek-chat`) no longer pays the 32000-token reasoning ceiling and keeps
  `temperature` on review. `on`/`off` force it (for example `on` for a custom
  reasoning model whose name is not recognized). It has no effect on the openai
  dialect, which has no thinking mode.

### Internal

- Extract a provider-neutral OpenAI-compatible chat-completion base
  (`providers/openai-chat`) that owns the degradation skeleton every adapter
  repeated by hand — skip an empty batch, degrade rather than throw when the API
  key is missing, and turn a thrown request/parse error into per-unit `failed`
  results so the client stays the single retry layer — and replace the hardcoded
  provider if-chain with a registry map (`PROVIDERS`) that the supported-name
  list and `ProviderName` type derive from. The DeepSeek provider is now a thin
  dialect (a client plus four labels) over the shared base, so adding an
  OpenAI-shaped provider is one small subclass and one registry entry instead of
  a copy of the whole translate/review/character pipeline. No runtime behavior
  changed; the shared degradation contract is covered by its own tests.

## 0.1.8 - 2026-06-26

### Changed

- Per-command `--help` now states the command-specific meaning of the overloaded
  `--out` and `--report` flags (a units file vs a report vs a patch directory; a
  report written vs read) instead of one generic description, so each command's
  help is unambiguous.
- `characters` accepts the translations file as an optional second positional
  (`characters <units.json> [translations.json]`), consistent with
  `review`/`validate`/`repair`; `--translations` remains as a deprecated alias.
  Passing it positionally is no longer rejected.
- Fold a prompt version into the resumable run signature and the translation
  memory key, so editing the prompt wording (and bumping the version) discards
  stale checkpoints and is a memory miss instead of silently replaying output
  produced under the old prompts. The Phase 2 prompt changes above bump it once,
  resetting checkpoints/memory a single time on the next run.
- The review/repair prompt now explains how to use the injected character glossary
  (gender for agreement, `speechStyle` for voice, `translation` for the display
  name), and the character glossary is relevance-filtered and capped per batch like
  the term glossary, instead of sending the entire cast with every review batch.
- Instruct the review/repair pass to read and resolve the `validationIssues` the
  payload already carries (it sent the exact violation but never told the model to
  act on it), so repair fixes the named problem — `MAX_LENGTH_EXCEEDED`, a missing
  placeholder, an altered number — instead of doing a cosmetic rewrite that
  re-trips the same rule. Added only when a batch carries issues.
- Inject the character glossary into the **first-pass** translate prompt (not only
  review), relevance-filtered to the speakers/names in each batch and capped per
  batch, so the first pass already uses the correct pronoun, display name and
  speech style instead of leaving it all to the review pass. The first-pass cache
  key now folds in the character glossary so a different one is a memory miss; a
  run without a character glossary keeps its existing memory.
- Explain the per-unit length constraints (`maxLength`/`maxLines`) in the
  translate and review system prompts when a batch carries them, defining display
  width the same way validation measures it (full-width = 2 cells, half-width = 1,
  placeholders/escape codes = 0). The first pass now fits text to the message
  window instead of producing overflow that the repair pass has to fix, so repair
  converges faster. The instruction is added only when a batch actually carries a
  length constraint.

### Added

- Add `--include-notes` (config `includeNotes`) to extract the database `note`
  field (notetag text) for `extract`/`run`/`apply`. Off by default — notes often
  hold plugin configuration rather than display text — and when off, a non-empty
  note is flagged with a one-per-file advisory so translatable note content is not
  silently dropped. The flag is folded into the resume signature.
- Add an `estimate` command (`estimate <units.json> [--batch-size <n>]
  [--price-per-1k <usd>]`) that reports the batch count, input tokens and a
  total-token estimate (with an optional USD band), so a job can be sized before
  committing. Writes nothing.
- Enrich `run --dry-run`: the estimate now runs *after* checkpoint resume and
  excludes translation-memory hits (so it reflects what would actually be sent),
  names the passes it would run (translate / review / repair), and shows an
  optional USD band with `--price-per-1k`.
- Add `--concurrency <n>` (config `concurrency`) to translate several translation
  batches at once for `translate` and `run` (default 1, i.e. unchanged serial
  behavior). Provider requests overlap up to the limit, while the per-batch
  checkpoint append and token-budget check are serialized so they cannot race, and
  an over-budget run still aborts cleanly mid-flight.
- Add a `clean` command for safe recovery from a crashed or abandoned run: it
  removes the work-dir checkpoints and the run lock by default (preserving the
  translation memory), with `--with-memory`/`--all` to also remove memory,
  `--checkpoints`/`--lock` to select categories, and `--dry-run` to preview. It
  only ever touches files inside the work directory, never the game or the patch
  output, so a translator no longer has to hand-`rm` internal files.
- Add a `status` command that inspects a run's resumability without modifying
  anything: it reports the translated/reviewed/repaired counts against the unit
  total, the stored run signature, and — given the game and the flags you would
  re-run with — whether the next run would RESUME from the checkpoints or RESET
  (naming which inputs changed: language, model, glossary, game, or sampling/
  extraction flags).
- Add a `diff` command that shows per-unit before/after across the translate,
  review and repair passes (`diff <raw.json> <reviewed.json> [repaired.json]`),
  listing only the units whose translation changed, as Markdown to `--out` or
  stdout — so a translator can see and trust what each pass changed.
- Add `characters check <characters.json>` to validate a character glossary
  (enum gender/type, alias/field shapes) and list the entries flagged
  `review:true`, exiting non-zero on an invalid file so a CI check can gate on it.
- Add `run --from-translations <file>` to fold hand-edited translations back into a
  resumed run. `run` resumes from the JSONL checkpoints, so a translator's edits to
  `translations.json` were silently ignored and overwritten; this seeds the
  checkpoint from the given file (matching by id and source) so the edits are
  honored and not re-translated. `run` also now warns on resume when a work-dir
  `translations.json` is newer than the checkpoint, pointing at the new flag.
- Add a `report summarize` command that renders the JSON validation report as a
  human-readable Markdown review document, joining each issue to its source text,
  translation and file location, grouped by file and ordered by severity — so a
  translator can see and act on what to fix without reading the raw report JSON.
  Writes to `--out` or prints to stdout.
- Add a `memory` command to operate the translation-memory file directly:
  `memory stats` reports live entries, superseded lines and bytes; `memory compact`
  rewrites the log without superseded lines; and `memory prune` removes entries by
  `--before <ISO date>`, `--model`, and/or `--provider` (combined with AND, and
  refusing a filter-less prune so the whole memory cannot be wiped by a slip). The
  command does not read project config, so its `--model`/`--provider` are prune
  filters rather than translation settings. Writes go through the new memory lock.
- Persist the reviewed/repaired translations to memory (not only the raw
  first-pass output), under the same per-unit cache key the translate pass looks
  up, so a re-run reuses the higher-quality reviewed text instead of replaying the
  pre-review translation or re-spending review/repair tokens. Memory entries carry
  a `reviewed`/`repaired` provenance flag, and a memory hit reports it so a
  no-review re-run still ships review-quality text.
- Extract `Troops.json` — troop names and in-battle event command lists (boss and
  battle `Show Text`, choices, plugin commands) per page. These were silently
  dropped because `Troops.json` had no field mapping, so battle dialogue went
  untranslated; it now extracts with stable ids such as
  `Troops.5.pages.0.list.1.parameters.0` that `apply` writes back.
- Add a `config` command. `config validate` loads and type-checks the project
  config, exits non-zero on a malformed file (naming the problem), and lists
  unknown keys with a did-you-mean suggestion; `config print` shows the loaded
  config, and `config print <command>` shows exactly which flags config injects
  into that command (reflecting the `out` scoping and flag aliases) — so a
  dropped or mistyped key is visible without running a real command. The unknown
  config-key warning now also suggests the closest key during normal runs.
- Add a `doctor` command that runs preflight checks before a paid run: the
  provider is supported, `DEEPSEEK_API_KEY` is set (for deepseek), an optional
  game path is a recognized RPG Maker project, and the provider answers a single
  tiny probe translation at the resolved base-url/model. Every check runs (one
  failure does not hide the rest); per-check pass/fail with remediation goes to
  stdout and the command exits non-zero if any check fails — so a bad key,
  unreachable endpoint or wrong game is caught before extraction spend, not during.
- Add an `init` command that scaffolds onboarding: it writes a
  `rpgm-ai-translator.json` project config with safe defaults, a `.env.example`
  with an empty `DEEPSEEK_API_KEY=` placeholder (never a real key), and copies the
  example glossary/character files as editable starting points. `--out` chooses
  the config path; `--force` overwrites an existing scaffold (without it, `init`
  refuses to clobber your config). stdout lists the created files; the next-step
  hint goes to stderr.
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

### Documentation

- Add a CLI changes / migration reference ([docs/migration.md](docs/migration.md))
  listing the new commands, flag aliases/renames (with the old forms that still
  work), new flags, and behavior changes.
- Add a "translate your first game" end-to-end tutorial
  ([docs/tutorial.md](docs/tutorial.md)) covering init, dry run, doctor preflight,
  the full `run`, review/diff, hand-edit re-import, and shipping the patch.
- Add a Windows (PowerShell) quick start to the README — single-line and
  backtick-continued command forms, `$env:`/`setx` for the API key, and a note
  that Node accepts forward-slash paths — since the other examples assume bash
  line continuations.
- Add a "Local Or OpenAI-Compatible LLM" quick start to the README with concrete
  Ollama and LM Studio `--base-url`/`--model` examples, an explanation of the
  request dialect, and a `doctor` preflight step.

### Internal

- Add integration coverage for concurrent memory writers (a second writer with a
  stale cache, and a compaction that must not drop another writer's appends) and
  crash-resume (a run resuming past a checkpoint truncated by a crash mid-write).
- Add a CLI behavior test suite: a per-command `--help` matrix (usage to stdout,
  exit 0, clean stderr) that fails if a new command ships without per-command
  help, the exit-code contract (0 success, 1 unknown command / missing argument,
  2 apply-blocking validation), stdout/stderr stream separation for `extract`, and
  config precedence (config value applied, explicit CLI flag overrides it).
- Add a byte-for-byte golden test of the patch writer's output — indentation, BOM,
  CRLF/LF line endings, trailing newline, minified files, and the `plugins.js`
  header and array round-trip — so any future change that reshapes a shipped patch
  fails the test suite.

### Changed

- `apply` now rejects `--font`/`--number-font` outside `--mode patch` with `--out`
  (previously a silent no-op that shipped a game with no font change) and warns
  that `--dialogue-max-length` is ignored when `--units` is given (the constraints
  come from the saved units file, since apply does not re-extract).
- Scope the project-config `out` key to `run`, `apply`, and `patch-font` (where
  it consistently means the patch output directory) instead of injecting it into
  every command. `out` names a different artifact for each manual-pipeline command
  (`extract` writes `units.json`, `validate` a report, `translate`/`review`/`repair`
  a translations file), so a single config value previously redirected an
  unrelated command's output to the wrong path; those commands now require an
  explicit `--out`. An explicit `--out` on the command line is unaffected.
- `apply` (patch mode) and `run` now refuse to write into a non-empty output
  directory by default and accept a new `--force` flag to override. Patch mode
  writes only the changed files, so overlaying a fresh patch onto a stale one (or
  an unrelated directory) silently mixed two generations; refusing avoids that.
  `run` still freely overwrites an `--out` it produced for the same game, so the
  normal resume/re-run workflow is unaffected; pointing it at a different game's
  output requires `--force` (which then resets the shared work directory).

### Fixed

- Read a BOM-prefixed data file instead of silently skipping it. A Windows-saved
  `System.json` (or other data file) with a leading UTF-8 BOM made `JSON.parse`
  throw, so the whole file was skipped with a warning and its units were dropped;
  the leading BOM is now stripped before parsing.
- Give scroll text (Show Scrolling Text, event code 405) its own constraints
  instead of the 52-cell Show Text dialogue budget. Scroll text scrolls vertically
  with no per-line width limit, so it was being flagged with spurious
  `MAX_LENGTH_EXCEEDED`; a 405 line now carries no `maxLength`, while a Show Text
  (401) line keeps the budget.
- `detect` exits non-zero when the project is not a recognized RPG Maker MV/MZ
  game (it still prints the JSON), so a wrapping script can branch on `$?` instead
  of parsing the output for `"engine": "unknown"`.
- Append the dominant failure cause to the total-failure abort message in `run`
  and `translate` (for example `Dominant cause: PROVIDER_AUTH_ERROR — Invalid API
  key.`), so a pasted "all units failed" line says *why* — auth, billing, network,
  or response truncation — instead of just the count.
- Name the offending entry and field when a glossary or character glossary fails
  to load, instead of one generic message for the whole file — for example
  `Invalid glossary term 'Aria' in '<file>': 'mode' must be one of …` or
  `Invalid character 'Aria' in '<file>': 'gender' must be one of …` — so a typo is
  easy to find.
- Guard the translation-memory file against concurrent writers. Two processes
  sharing one `--memory` file each held a private cached view, so the first to
  cross the compaction threshold rewrote the whole file from its stale cache and
  discarded the other's appended entries. Memory writes now serialize on a
  per-file lock and re-read the file fresh inside the lock before appending or
  compacting (last-`updatedAt` wins on a key touched by both), so no entries are
  lost; a still-held lock from a live writer fails fast with a clear message.
- Make a custom `--base-url` actually work with a generic OpenAI-compatible or
  local endpoint. The DeepSeek adapter always sent the proprietary `thinking`
  field, which a generic/local server rejects with a non-retryable 400, so
  `--base-url` was effectively broken despite being documented. The client now
  has a dialect: `deepseek` sends the `thinking` field as before, while `openai`
  omits it and always sends `temperature`. The dialect is auto-selected (`openai`
  for any non-default `--base-url`, `deepseek` for the DeepSeek endpoint) and can
  be forced with `--api-dialect deepseek|openai|auto` or the `apiDialect` config
  key — so a DeepSeek instance behind a proxy can still use the proprietary field.
- Report an actionable error when a `units` or `translations` file passed to
  `translate`/`review`/`repair`/`validate`/`apply` does not exist, naming the file
  (`Could not read units file '<path>': file not found.`) instead of surfacing a
  raw `ENOENT`, matching the scoped errors the config/glossary loaders already give.
- Make the `--max-tokens-budget` pre-flight check meaningful. The estimate counted
  only source characters (input), but the budget trips on the provider's reported
  *total* (input + output) tokens, so the two disagreed by a large multiplier and
  an over-budget run passed pre-flight only to abort mid-run after spending. The
  budget guards now estimate total tokens — folding in a per-batch system-prompt
  overhead and an output multiplier — so they fail before a pass starts when it
  would overrun. The dry-run preview still reports input tokens.
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
