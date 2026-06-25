# Architecture

`rpgm-ai-translator` follows a hexagonal (ports-and-adapters) design. The domain —
detecting, extracting, validating, translating, and patching — lives in `src/core`
and depends on nothing outward. Everything that talks to the outside world (an RPG
Maker project on disk, an LLM HTTP API, config files, the command line) is an
adapter around that core. The guiding rule has held from the start: game-file logic
does not know about DeepSeek, and provider code does not know how to patch RPG Maker
projects.

## Layers and dependency direction

Dependencies point inward only. `cli` is the composition root and may import any
layer; `engines`, `providers`, and `config` are adapters that depend only on `core`;
`core` is the domain and depends on no outer layer.

```text
        ┌─────────────────────────── cli ───────────────────────────┐
        │   composition root: argv, commands, help, orchestration    │
        └───────────┬────────────────┬────────────────┬─────────────┘
                    │                │                │
            ┌───────▼─────┐   ┌──────▼──────┐   ┌─────▼──────┐
            │   engines   │   │  providers  │   │   config   │   adapters
            │ rpgmaker-   │   │  deepseek,  │   │  project,  │
            │    mvmz     │   │    mock     │   │  glossary  │
            └───────┬─────┘   └──────┬──────┘   └─────┬──────┘
                    │                │                │
                    └────────────────▼────────────────┘
                            ┌─────────────────┐
                            │      core       │   domain + ports
                            │ (depends on     │
                            │  nothing out)   │
                            └─────────────────┘
```

- **`src/core`** — the domain. Owns the shared vocabulary (`core/types`), the ports
  (`core/ports`: the `LLMProvider`, `Extractor`, and `EngineDetector` interfaces a
  consumer implements to add a provider or engine), and the provider-neutral
  pipeline. Depends on no outer layer.
- **`src/engines/rpgmaker-mvmz`** — the RPG Maker MV/MZ adapter: engine detection,
  extraction, patch writing, and plugin/font support. Implements `core` ports and
  depends only on `core`.
- **`src/providers`** — LLM adapters (`deepseek`, `mock`) and their prompt builders.
  Implement `LLMProvider` and depend only on `core`.
- **`src/config`** — loaders for the project config file, glossary, and character
  glossary. Depend only on `core`.
- **`src/cli`** — the composition root: argument parsing, option validation,
  per-command help, and pipeline orchestration. Wires the adapters to the core.

Two entry points sit above the layers: `src/index.ts` (the package's public API) and
`src/cli/index.ts` (the `rpgm-ai-translator` binary).

## Module facades

Every multi-file module exposes a single `public-api.ts`. Code outside a module
imports it only through that facade, never its internal files: the facade is the
module's contract, and its internals are free to change behind it. The pure
vocabulary in `core/types` is the one barrel that depends on nothing — not even the
ports defined over it. Ports are imported from `core/ports/public-api` directly, so
the vocabulary has no back-edge to the interfaces above it and the module graph stays
acyclic.

## Enforced boundaries

The layering and the facade rule are not conventions — they are checked.
`eslint.config.js` declares the dependency direction and "import a module only
through its `public-api`" as `no-restricted-imports` patterns, so a `core` file
importing an adapter, an adapter importing the cli, or any file reaching past a
module's facade fails `npm run lint` (and CI). The architecture therefore cannot
erode silently; a boundary violation is a build failure, not a review comment.

## core structure

- `core/types` — the shared vocabulary (units, results, glossary, options, reports).
- `core/ports` — the interfaces adapters implement (`LLMProvider`, `Extractor`,
  `EngineDetector`).
- `core/pipeline` — provider-neutral passes: `review`, `repair`, `revalidation`, and
  `characters` (candidate extraction and glossary generation).
- `core/memory` — append-only JSONL translation memory and deduped, retried
  translation batches.
- `core/validators` — technical and terminology validation (individual rules under
  `validators/rules`).
- `core/reports` — JSON report generation and CLI summaries.
- `core/utils` — leaf helpers (filesystem, hashing, JSON-path, text width).
- Leaf modules: `core/placeholders` (control-code round-tripping),
  `core/translation-units` (units/results JSON IO), `core/cost` (token estimation,
  usage aggregation, and the budget cap), `core/locks` (work-directory locking),
  `core/batching`, and `core/retry` (the shared provider retry policy).

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
files go to the patch output directory. Each stage appends a JSONL checkpoint as it
completes, so re-running `run` resumes from the last completed work instead of
re-calling the provider. `run` always writes a patch, so its `--mode`/`--backup`
flags are ignored.

The manual pipeline exposes the same stages as individual commands:

```text
detect -> extract -> translate -> characters -> review -> validate -> repair -> validate -> apply
```

## Engine adapters

The first engine adapter is `RpgMakerMvMzExtractor` (`src/engines/rpgmaker-mvmz`). It
handles MV/MZ JSON data, map events, common events, selected Control Variables string
literals, selected plugin command runtime text, and selected JSON-encoded plugin text
fields. Show Text speaker names are preserved as context by default rather than
extracted as translation units, because many games and plugins use them as technical
portrait lookup keys. They can be opted in with `includeSpeakerNames` /
`--include-speaker-names`.

VX Ace, VX, and XP are intentionally out of scope. They should be added as separate
adapters under `src/engines` that implement the shared `Extractor` and
`EngineDetector` ports from `core/ports`.

## Providers

Providers implement `LLMProvider`. The current adapters are:

- `mock`: deterministic local translations for tests and dry runs;
- `deepseek`: OpenAI-compatible Chat Completions calls to DeepSeek.

`createProvider(name, config)` injects connection config (`apiKey`, `baseUrl`,
`model`), so any OpenAI-compatible endpoint can be used via `--base-url`. Provider
implementations receive normalized units and return `TranslationResult` objects; they
do not read or write game files. Token usage is mapped into a provider-neutral
`TokenUsage` shape. The provider client is the single retry layer (honoring
`--retry-attempts`): transient failures are retried internally with exponential
backoff and jitter, while authentication and billing errors are never retried.

## Validation and safety

Validation is technical rather than literary. It checks placeholders, RPG Maker
control codes, variables, numbers, glossary constraints, missing translations, and
layout constraints such as `maxLength` and `maxLines`.

The `run` command applies only translations that do not have validation errors.
Warnings are reported but still applied. The manual `apply` command can do the same
filtering when passed `--report`; without `--report`, it assumes the caller has
already validated the translations.

Patch mode writes changed files to a separate output folder and never touches the
game directory. In-place mode creates a backup first, then replaces files; both modes
roll back every already-written file if a later write fails, so an interrupted apply
cannot leave a half-patched game. Patch mode remains the recommended default.

## Testing and coverage

Tests are colocated under `tests/` and run with Vitest. Coverage is measured with the
v8 provider (`npm run coverage`) and gated in CI against a floor declared in
`vitest.config.ts`, so coverage cannot regress unnoticed. The failure-recovery paths
get explicit tests because they only run after something has already gone wrong: the
patch writer's rollback on a partial patch and its in-place restore from backup, and
the provider's handling of malformed or truncated LLM responses.

## Current limitations

- Text fitting is best-effort: too-long translations are reported, can be targeted
  with `repair`, and can be included in the one-shot pipeline with `run --repair`.
  `maxLength` is measured in East Asian display cells; the per-line dialogue limit is
  overridable with `--dialogue-max-length`.
- JSONL memory is append-only with periodic compaction, which avoids rewriting the
  whole file on every upsert, but SQLite would still scale better for concurrent or
  very large translation projects.
- Plugin support is intentionally conservative. It handles explicit text fields and
  selected JSON-encoded text fields, but will still miss some plugin-specific formats.
- Character inference is heuristic and should be manually reviewed.
- Releases are tagged and changelog-driven; see [../CHANGELOG.md](../CHANGELOG.md).
