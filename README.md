# rpgm-ai-translator

`rpgm-ai-translator` is a CLI pipeline for AI-assisted translation of RPG Maker
MV/MZ games.

AI disclosure: this project was developed with assistance from the Codex AI coding
agent. Human review is still required for translation quality, legal compliance,
and release decisions.

The tool extracts translatable text from RPG Maker JSON data, protects RPG Maker
control codes, translates through provider adapters such as DeepSeek, validates the
result, and writes a safe patch folder without modifying the original game.

```text
detect -> extract -> translate -> characters -> review -> validate -> repair -> apply patch -> report
```

## Status

This is an alpha tool for technical translators. It already works on real MV/MZ
projects, but it still expects validation reports and manual review.

Supported:

- RPG Maker MV and MZ JSON data under `data/` or `www/data/`;
- map/common event dialogue, choices, scroll text, and speaker names;
- safe string literals in Control Variables commands, often used for quest text;
- selected runtime plugin command text such as `messageText`;
- selected JSON-encoded plugin text fields such as `label`, `text`, and `messageText`;
- cautious plugin parameter extraction with `--include-plugins`;
- speaker names are kept as context by default to avoid breaking portrait plugins;
- DeepSeek and any OpenAI-compatible Chat Completions endpoint (`--base-url`);
- mock provider for tests and dry runs;
- JSONL translation memory;
- resumable `run` with per-stage JSONL checkpoints and a separate work directory;
- project config file to set defaults instead of repeating flags;
- token/cost estimation, provider-neutral usage reporting, and a token budget cap;
- character glossary generation and review pass;
- glossary validation;
- targeted repair for validation issues with repeated attempts and checkpointing;
- safe patch output;
- optional RPG Maker MZ font patching.

Not supported yet:

- RPG Maker VX Ace, VX, XP;
- GUI;
- OCR or screenshot review;
- guaranteed extraction from every plugin-specific format;
- guaranteed automatic text fitting;
- distribution of translated commercial game assets.

## Requirements

Install these dependencies before building from source:

- Node.js `20.19.0` or newer;
- npm, included with Node.js;
- git, for cloning the repository;
- a POSIX-like shell for the examples below;
- `DEEPSEEK_API_KEY`, only when using `--provider deepseek`.

No native compiler toolchain is required by the current dependency set.

## Build From Source

Clone and install dependencies:

```bash
git clone git@github.com:atomskz/rpgm-ai-translator.git
cd rpgm-ai-translator
npm ci
```

Run the local checks:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run pack:check
```

Run the built CLI directly:

```bash
node dist/cli/index.js --help
```

After package installation, the binary name is:

```bash
rpgm-ai-translator
```

## Quick Start

Use the mock provider first. It does not call an API and prefixes source text with
`[ru]`, which is useful for checking extraction and patch writing.

```bash
npm run build

node dist/cli/index.js run ./examples/mz-sample \
  --provider mock \
  --target ru \
  --include-plugins \
  --repair \
  --out ./out/mz-sample-patch
```

The patch folder (`--out`) contains only patched RPG Maker game files. All
intermediate artifacts are written to a separate work directory next to it
(`<out>-work` by default, override with `--work-dir`):

- `units.json`;
- `translations.raw.json`, `translations.reviewed.json`, `translations.json`;
- per-stage JSONL checkpoints (`translations.raw.jsonl`, ...) used to resume an
  interrupted run;
- `translation-memory.jsonl`;
- `report.json`.

Keeping intermediates out of the patch folder means a shipped patch never
includes your translation memory or reports.

## Usage

### Detect A Game

```bash
node dist/cli/index.js detect ./game
```

The command prints the detected engine, data directory, plugin file path, confidence,
and detection reasons as JSON.

### Extract Translation Units

```bash
node dist/cli/index.js extract ./game \
  --include-plugins \
  --out ./work/units.json \
  --report ./work/extract-report.json
```

Use `--include-comments` if event comments should be included. Use
`--include-plugins` cautiously because plugin formats vary heavily between games.
Speaker names from RPG Maker MZ/MV `Show Text` commands are not translated by
default because many games and plugins use them as portrait lookup keys. Use
`--include-speaker-names` only if the game does not depend on speaker names as
technical identifiers. Use `--dialogue-max-length <n>` to override the per-line
dialogue width limit (default `52` display cells) when the game's message font
fits more or fewer characters; the limit is baked into each dialogue unit's
`maxLength` constraint.

### Translate With DeepSeek

Set the API key through the environment. Do not commit keys or `.env` files.

```bash
export DEEPSEEK_API_KEY=sk-...

node dist/cli/index.js translate ./work/units.json \
  --provider deepseek \
  --model deepseek-v4-flash \
  --target ru \
  --batch-size 10 \
  --retry-attempts 2 \
  --timeout-ms 30000 \
  --temperature 0.3 \
  --max-tokens 8192 \
  --memory ./work/translation-memory.jsonl \
  --checkpoint ./work/translations.raw.checkpoint.jsonl \
  --out ./work/translations.raw.json
```

`--batch-size` is the number of translation units sent to the provider in one
request. Smaller batches are slower but safer for large or context-heavy strings.
For DeepSeek, `--temperature` controls sampling randomness and `--max-tokens`
sets the response token limit. The defaults are `0.3` and `8192` (the translate
pass disables thinking; the reasoning review/repair passes default to `32000` —
see [Reasoning passes and `max_tokens`](#reasoning-passes-and-max_tokens)).
Use `--base-url <url>` to target any OpenAI-compatible endpoint (including a
local one), and `--max-tokens-budget <n>` to abort the run before it exceeds a
token budget.
When `--out` is provided, `translate` also writes a JSONL checkpoint after each
completed batch. Without `--checkpoint`, the path is derived from `--out` (for
example `translations.raw.json` becomes `translations.raw.jsonl`) and written
fresh each run — a standalone `translate` does not resume from it. To resume,
pass `--checkpoint <file>`: existing translated entries in that JSONL file are
reused and only missing units are sent to the provider. (The `run` pipeline
manages and resumes its own per-stage checkpoints in the work directory.)

### Generate Character Glossary

```bash
node dist/cli/index.js characters ./work/units.json \
  --translations ./work/translations.raw.json \
  --provider deepseek \
  --model deepseek-v4-flash \
  --target ru \
  --out ./work/characters.json
```

Review `characters.json` manually. Gender, role, and speech style inference is
heuristic and should be corrected before the review pass.

### Review Dialogue

```bash
node dist/cli/index.js review ./work/units.json ./work/translations.raw.json \
  --provider deepseek \
  --model deepseek-v4-flash \
  --target ru \
  --characters ./work/characters.json \
  --checkpoint ./work/translations.reviewed.checkpoint.jsonl \
  --out ./work/translations.reviewed.json
```

The review pass focuses on dialogue and choices grouped by map/event context.
It writes a JSONL checkpoint after each completed review batch. When
`--checkpoint` points to an existing JSONL file, already reviewed entries are
reused.

#### Reasoning passes and `max_tokens`

`review` and `repair` enable the provider's reasoning mode. A reasoning model
spends `max_tokens` on its chain-of-thought before emitting the answer, so these
passes default to a larger `--max-tokens` (`32000`) than `translate` (`8192`).
If you set `--max-tokens` too low for a reasoning pass, the provider can return
an empty or truncated response; the CLI reports this as a clear error asking you
to raise `--max-tokens`. Packing many long lines into one batch makes this more
likely, so lowering `--batch-size` also helps. See
[docs/troubleshooting.md](docs/troubleshooting.md).

### Validate And Repair

```bash
node dist/cli/index.js validate ./work/units.json ./work/translations.reviewed.json \
  --out ./work/report.json

node dist/cli/index.js repair ./work/units.json ./work/translations.reviewed.json \
  --report ./work/report.json \
  --provider deepseek \
  --model deepseek-v4-flash \
  --target ru \
  --codes MAX_LENGTH_EXCEEDED,MISSING_TRANSLATION \
  --attempts 2 \
  --characters ./work/characters.json \
  --checkpoint ./work/translations.repaired.checkpoint.jsonl \
  --out ./work/translations.repaired.json

node dist/cli/index.js validate ./work/units.json ./work/translations.repaired.json \
  --out ./work/report.repaired.json
```

Repair is provider-assisted, not magic. `--attempts` revalidates after each pass
and retries remaining targeted issues such as `MAX_LENGTH_EXCEEDED`. Always
inspect the final report before shipping a patch.

### Apply Patch

```bash
node dist/cli/index.js apply ./game ./work/translations.repaired.json \
  --mode patch \
  --include-plugins \
  --units ./work/units.json \
  --report ./work/report.repaired.json \
  --out ./work/patch
```

When `--report` is provided, translations with validation errors are skipped.
Warnings are reported but still applied. `--units` makes apply use the exact
extracted units from the manual pipeline instead of re-extracting with possibly
different extraction flags; without `--units`, apply re-extracts the game and
warns loudly if most translations are skipped because their ids no longer match.
Add `--dry-run` to preview the file/unit/skip counts without writing anything.

### One-Command Pipeline

```bash
node dist/cli/index.js run ./game \
  --provider deepseek \
  --model deepseek-v4-flash \
  --target ru \
  --batch-size 10 \
  --retry-attempts 2 \
  --timeout-ms 30000 \
  --temperature 0.3 \
  --max-tokens 8192 \
  --include-plugins \
  --review \
  --characters ./work/characters.json \
  --repair \
  --repair-attempts 1 \
  --repair-codes MAX_LENGTH_EXCEEDED,MISSING_TRANSLATION \
  --out ./out/deepseek-patch
```

The `run` command validates before applying and writes only translations without
validation errors to the patch folder. It checkpoints each stage (translate,
review, repair) to the work directory, so re-running after a crash resumes from
the last completed work instead of re-calling the provider. Intermediates and
memory go to the work directory (`--work-dir`, default `<out>-work`), never the
patch folder. `run` always writes a patch, so `--mode` and `--backup` are
ignored. Add `--dry-run` to stop after extraction and print an estimate (units,
files, approximate input tokens) without calling the provider or writing a patch.

## Configuration File

To avoid repeating the same flags on every command, put defaults in a project
config file. By default the CLI loads `rpgm-ai-translator.json` from the current
directory; pass `--config <file>` to use another path.

```json
{
  "provider": "deepseek",
  "model": "deepseek-v4-flash",
  "target": "ru",
  "includePlugins": true,
  "review": true
}
```

Precedence is **command-line flag > config file > built-in default**. Keys mirror
the flag names; for example `provider`, `baseUrl`, `model`, `target`, `batchSize`,
`maxTokens`, `out`, `workDir`, `glossary`, `characters`, `includePlugins`,
`review`, `repair`. This is only a sample — see
[docs/configuration.md](docs/configuration.md) for the complete, authoritative
key list (an unknown key is reported with a warning).

## Getting Help And Debugging

Every command prints its own usage and flags:

```bash
node dist/cli/index.js --help          # global help and command list
node dist/cli/index.js run --help      # flags for a single command
```

On a usage error the CLI prints the command usage and a `--help` hint. Add
`--verbose` to any command to print the full error stack and cause chain when a
run fails. The full per-command flag reference lives in
[docs/cli-reference.md](docs/cli-reference.md), and common failures are covered
in [docs/troubleshooting.md](docs/troubleshooting.md).

## Fonts

RPG Maker MZ games may need a font that supports the target language.

```bash
node dist/cli/index.js apply ./game ./work/translations.reviewed.json \
  --mode patch \
  --out ./work/patch \
  --report ./work/report.json \
  --font ./fonts/NotoSans-Regular.ttf \
  --number-font ./fonts/NotoSans-Bold.ttf
```

`--font` changes the main game font. `--number-font` changes the font used by MZ
for number-heavy UI. If `--number-font` is omitted, the main font is reused.

## Glossary

Glossaries are JSON files:

```json
{
  "Aria": {
    "translation": "Ария",
    "mode": "custom"
  },
  "Ether": {
    "translation": "Эфир",
    "mode": "custom"
  }
}
```

Modes:

- `keep`: keep the original term unchanged (enforced in validation);
- `custom`: require the supplied `translation` (enforced in validation);
- `translate`: translate the term normally for meaning (advisory; sent to the
  model in the prompt but not mechanically checked);
- `transliterate`: render the term phonetically (advisory).

All modes are described to the model in the system prompt. `keep` and `custom`
are checked by the validator and raise `GLOSSARY_VIOLATION` when broken;
alphabetic terms are matched on word boundaries (so `Ko` does not match
`Kobold`), while CJK terms are matched as substrings. Pass a glossary with
`--glossary ./glossary.json`. See [examples/glossary.json](examples/glossary.json).

## Safety

The default workflow writes a patch folder. It does not modify the original game.

Do not commit or publish:

- API keys;
- real commercial game files;
- generated translation memory containing proprietary text;
- patched commercial assets unless you have the right to distribute them.

Distribute patches responsibly. This project is meant to help translate legally
owned games and should not be used to redistribute copyrighted assets.

## Development Notes

The core logic is provider-independent. New engines and providers should be added
through adapters rather than by coupling provider code to extract/apply logic.

Useful commands:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run pack:check
```

## Documentation

- [docs/cli-reference.md](docs/cli-reference.md) — every command and flag.
- [docs/configuration.md](docs/configuration.md) — project config file, environment, and precedence.
- [docs/troubleshooting.md](docs/troubleshooting.md) — common errors and validation issue codes.
- [docs/architecture.md](docs/architecture.md) — module boundaries and pipeline details.
- [CHANGELOG.md](CHANGELOG.md) — release notes.


## License

rpgm-ai-translator is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This project is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

See the [LICENSE](./LICENSE) file for details.
