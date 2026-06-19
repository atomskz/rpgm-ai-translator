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
- DeepSeek through the OpenAI-compatible Chat Completions API;
- mock provider for tests and dry runs;
- JSONL translation memory;
- character glossary generation and review pass;
- glossary validation;
- targeted repair for validation issues;
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

The output folder contains:

- patched RPG Maker files;
- `units.json`;
- `translations.json`;
- `translation-memory.jsonl`;
- `report.json`.

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
technical identifiers.

### Translate With DeepSeek

Set the API key through the environment. Do not commit keys or `.env` files.

```bash
export DEEPSEEK_API_KEY=sk-...

node dist/cli/index.js translate ./work/units.json \
  --provider deepseek \
  --model deepseek-chat \
  --target ru \
  --batch-size 10 \
  --retry-attempts 2 \
  --timeout-ms 30000 \
  --memory ./work/translation-memory.jsonl \
  --out ./work/translations.raw.json
```

`--batch-size` is the number of translation units sent to the provider in one
request. Smaller batches are slower but safer for large or context-heavy strings.

### Generate Character Glossary

```bash
node dist/cli/index.js characters ./work/units.json \
  --translations ./work/translations.raw.json \
  --provider deepseek \
  --model deepseek-chat \
  --target ru \
  --out ./work/characters.json
```

Review `characters.json` manually. Gender, role, and speech style inference is
heuristic and should be corrected before the review pass.

### Review Dialogue

```bash
node dist/cli/index.js review ./work/units.json ./work/translations.raw.json \
  --provider deepseek \
  --model deepseek-chat \
  --target ru \
  --characters ./work/characters.json \
  --out ./work/translations.reviewed.json
```

The review pass focuses on dialogue and choices grouped by map/event context.

### Validate And Repair

```bash
node dist/cli/index.js validate ./work/units.json ./work/translations.reviewed.json \
  --out ./work/report.json

node dist/cli/index.js repair ./work/units.json ./work/translations.reviewed.json \
  --report ./work/report.json \
  --provider deepseek \
  --model deepseek-chat \
  --target ru \
  --codes MAX_LENGTH_EXCEEDED,MISSING_TRANSLATION \
  --characters ./work/characters.json \
  --out ./work/translations.repaired.json

node dist/cli/index.js validate ./work/units.json ./work/translations.repaired.json \
  --out ./work/report.repaired.json
```

Repair is provider-assisted, not magic. Always inspect the final report before
shipping a patch.

### Apply Patch

```bash
node dist/cli/index.js apply ./game ./work/translations.repaired.json \
  --mode patch \
  --include-plugins \
  --report ./work/report.repaired.json \
  --out ./work/patch
```

When `--report` is provided, translations with validation errors are skipped.
Warnings are reported but still applied.

### One-Command Pipeline

```bash
node dist/cli/index.js run ./game \
  --provider deepseek \
  --model deepseek-chat \
  --target ru \
  --batch-size 10 \
  --retry-attempts 2 \
  --timeout-ms 30000 \
  --memory ./out/deepseek-memory.jsonl \
  --include-plugins \
  --review \
  --characters ./out/characters.json \
  --repair \
  --repair-attempts 1 \
  --repair-codes MAX_LENGTH_EXCEEDED,MISSING_TRANSLATION \
  --out ./out/deepseek-patch
```

The `run` command validates before applying and writes only translations without
validation errors to the patch folder.

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

- `keep`: keep the original term;
- `translate`: allow translation;
- `transliterate`: transliterate;
- `custom`: require the supplied translation.

Pass a glossary with `--glossary ./glossary.json`.

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

See [docs/architecture.md](docs/architecture.md) for module boundaries and pipeline
details.
