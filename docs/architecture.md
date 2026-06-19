# Architecture

`rpgm-ai-translator` is organized as a CLI orchestration layer over provider-neutral
core modules. The main rule is that game-file logic does not know about DeepSeek,
and provider code does not know how to patch RPG Maker projects.

## Layers

- `src/cli`: command parsing and pipeline orchestration.
- `src/config`: loaders for glossary and character glossary files.
- `src/core/engine-detector`: RPG Maker MV/MZ project detection.
- `src/core/extractors`: engine-specific extraction and apply adapter.
- `src/core/placeholders`: protection and restoration of RPG Maker control codes.
- `src/core/plugins`: cautious parsing and serialization of `js/plugins.js`.
- `src/core/translation-units`: JSON IO for units and translations.
- `src/core/validators`: technical and terminology validation.
- `src/core/patch-writer`: safe patch and in-place writing.
- `src/core/reports`: JSON report generation and CLI summaries.
- `src/core/memory`: JSONL translation memory and deduped translation batches.
- `src/core/characters`: character candidate extraction and character glossary generation.
- `src/core/review`: second-pass translation review grouped by map/event context.
- `src/core/font-patch`: RPG Maker MZ font patch support.
- `src/providers`: LLM provider adapters and prompt builders.

## Pipeline

The full `run` command performs:

```text
detect
extract
write units.json
translate with memory
optional review pass
validate
filter validation-error translations
apply patch
optional font patch
write translations.json
write report.json
```

The manual pipeline exposes the same stages as individual commands:

```text
detect -> extract -> translate -> characters -> review -> validate -> apply
```

## Engine Adapters

The first engine adapter is `RpgMakerMvMzExtractor`. It handles MV/MZ JSON data,
map events, common events, selected Control Variables string literals, and selected
plugin command runtime text.

VX Ace, VX, and XP are intentionally out of scope for the first version. They should
be added as separate adapters that implement the shared extractor interface.

## Providers

Providers implement `LLMProvider`. The current adapters are:

- `mock`: deterministic local translations for tests and dry runs;
- `deepseek`: OpenAI-compatible Chat Completions calls to DeepSeek.

Provider implementations receive normalized units and return `TranslationResult`
objects. They do not read or write game files.

## Validation And Safety

Validation is technical rather than literary. It checks placeholders, RPG Maker
control codes, variables, numbers, glossary constraints, missing translations, and
layout constraints such as `maxLength` and `maxLines`.

The `run` command applies only translations that do not have validation errors.
Warnings are reported but still applied. The `apply` command assumes the caller has
already validated the translations.

Patch mode writes changed files to a separate output folder. In-place mode creates a
backup first, but patch mode remains the recommended default.

## Current Limitations

- Text fitting is diagnostic only; too-long translations are reported but not
  automatically shortened yet.
- JSONL memory rewrites the memory file on each update; SQLite or batched writes
  would scale better.
- Plugin support is intentionally conservative and will miss some plugin-specific
  text formats.
- Character inference is heuristic and should be manually reviewed.
- Documentation and release packaging are still catching up with the implementation.
