# Architecture

`rpgm-ai-translator` is organized as a CLI orchestration layer over provider-neutral
core modules. The main rule is that game-file logic does not know about DeepSeek,
and provider code does not know how to patch RPG Maker projects.

## Layers

- `src/cli`: command parsing, option validation, per-command help, and pipeline orchestration.
- `src/config`: loaders for the project config file, glossary, and character glossary files.
- `src/core/engine-detector`: RPG Maker MV/MZ project detection (including data-only projects).
- `src/core/extractors`: engine-specific extraction and apply adapter.
- `src/core/placeholders`: protection and restoration of RPG Maker control codes.
- `src/core/plugins`: cautious parsing and serialization of `js/plugins.js`.
- `src/core/translation-units`: JSON IO for units and translations.
- `src/core/validators`: technical and terminology validation.
- `src/core/patch-writer`: safe patch and in-place writing that preserves original formatting.
- `src/core/reports`: JSON report generation and CLI summaries.
- `src/core/memory`: append-only JSONL translation memory and deduped translation batches.
- `src/core/cost`: input-token estimation, usage aggregation, and the token budget cap.
- `src/core/characters`: character candidate extraction and character glossary generation.
- `src/core/review`: second-pass translation review grouped by map/event context.
- `src/core/repair`: targeted repair of translations referenced by validation reports.
- `src/core/retry`: shared retry policy for provider calls.
- `src/core/font-patch`: RPG Maker MZ font patch support.
- `src/providers`: LLM provider adapters (with injected config) and prompt builders.

## Pipeline

The full `run` command performs:

```text
detect
extract
write units.json (work dir)
translate with memory   -> checkpoint translations.raw.jsonl
optional review pass    -> checkpoint translations.reviewed.jsonl
validate
optional repair pass    -> checkpoint translations.repaired.jsonl
revalidate
filter validation-error translations
apply patch (out dir)
optional font patch
write translations.json + report.json (work dir)
```

Intermediate artifacts, checkpoints, and translation memory are written to a
separate work directory (`--work-dir`, default `<out>-work`); only patched game
files go to the patch output directory. Each stage appends a JSONL checkpoint as
it completes, so re-running `run` resumes from the last completed work instead of
re-calling the provider. `run` always writes a patch, so its `--mode`/`--backup`
flags are ignored.

The manual pipeline exposes the same stages as individual commands:

```text
detect -> extract -> translate -> characters -> review -> validate -> repair -> validate -> apply
```

## Engine Adapters

The first engine adapter is `RpgMakerMvMzExtractor`. It handles MV/MZ JSON data,
map events, common events, selected Control Variables string literals, selected
plugin command runtime text, and selected JSON-encoded plugin text fields.
Show Text speaker names are preserved as context by default rather than extracted
as translation units, because many games and plugins use them as technical portrait
lookup keys. They can be opted in with `includeSpeakerNames` / `--include-speaker-names`.

VX Ace, VX, and XP are intentionally out of scope for the first version. They should
be added as separate adapters that implement the shared extractor interface.

## Providers

Providers implement `LLMProvider`. The current adapters are:

- `mock`: deterministic local translations for tests and dry runs;
- `deepseek`: OpenAI-compatible Chat Completions calls to DeepSeek.

`createProvider(name, config)` injects connection config (`apiKey`, `baseUrl`,
`model`), so any OpenAI-compatible endpoint can be used via `--base-url`. Provider
implementations receive normalized units and return `TranslationResult` objects;
they do not read or write game files. Token usage is mapped into a
provider-neutral `TokenUsage` shape. The provider client is the single retry
layer (honoring `--retry-attempts`): transient failures are retried internally
with exponential backoff and jitter, while authentication and billing errors are
never retried.

## Validation And Safety

Validation is technical rather than literary. It checks placeholders, RPG Maker
control codes, variables, numbers, glossary constraints, missing translations, and
layout constraints such as `maxLength` and `maxLines`.

The `run` command applies only translations that do not have validation errors.
Warnings are reported but still applied. The manual `apply` command can do the
same filtering when passed `--report`; without `--report`, it assumes the caller
has already validated the translations.

Patch mode writes changed files to a separate output folder. In-place mode creates a
backup first, but patch mode remains the recommended default.

## Current Limitations

- Text fitting is best-effort: too-long translations are reported, can be targeted
  with `repair`, and can be included in the one-shot pipeline with `run --repair`.
  `maxLength` is measured in East Asian display cells; the per-line dialogue limit
  is overridable with `--dialogue-max-length`.
- JSONL memory is append-only with periodic compaction, which avoids rewriting the
  whole file on every upsert, but SQLite would still scale better for concurrent or
  very large translation projects.
- Plugin support is intentionally conservative. It handles explicit text fields and
  selected JSON-encoded text fields, but will still miss some plugin-specific formats.
- Character inference is heuristic and should be manually reviewed.
- Releases are tagged and changelog-driven; see [../CHANGELOG.md](../CHANGELOG.md).
