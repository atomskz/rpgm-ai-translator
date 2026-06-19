# rpgm-ai-translator

CLI pipeline for AI-assisted translation of RPG Maker MV/MZ games.

The project extracts translatable text from RPG Maker JSON data, protects RPG Maker
control codes, translates through provider adapters such as DeepSeek, validates the
result, and writes a safe patch folder without modifying the original game.

```text
detect -> extract -> translate -> characters -> review -> validate -> apply patch -> report
```

## Status

This is an alpha tool for technical translators. It already works on real MV/MZ
projects, but it still expects validation reports and some manual review.

Supported:

- RPG Maker MV and MZ JSON data under `data/` or `www/data/`;
- map/common event dialogue, choices, scroll text, and speaker names;
- safe string literals in Control Variables commands, often used for quest text;
- selected runtime plugin command text such as `messageText`;
- cautious plugin parameter extraction with `--include-plugins`;
- DeepSeek through the OpenAI-compatible Chat Completions API;
- mock provider for tests and dry runs;
- JSONL translation memory;
- character glossary generation and review pass;
- glossary validation;
- safe patch output;
- optional MZ font patching.

Not supported yet:

- VX Ace, VX, XP;
- GUI;
- OCR or screenshot review;
- guaranteed extraction from every plugin-specific format;
- automatic fixing of text that is too long for a message window;
- distribution of translated commercial game assets.

## Install

Use Node.js 20 or newer.

```bash
npm install
npm run build
npm test
```

During development you can run the built CLI directly:

```bash
node dist/cli/index.js --help
```

After package installation, the binary name is:

```bash
rpgm-ai-translator
```

## Quick Mock Run

The mock provider does not call an API. It prefixes every source string with
`[ru]`, which is useful for checking extraction and patch writing.

```bash
npm run build

node dist/cli/index.js run ./game \
  --provider mock \
  --target ru \
  --include-plugins \
  --out ./out/mock-patch
```

The output folder will contain:

- patched RPG Maker files;
- `units.json`;
- `translations.json`;
- `translation-memory.jsonl`;
- `report.json`.

## DeepSeek Run

Set the API key through the environment. Do not commit keys or `.env` files.

```bash
export DEEPSEEK_API_KEY=sk-...

node dist/cli/index.js run ./game \
  --provider deepseek \
  --model deepseek-chat \
  --target ru \
  --batch-size 10 \
  --retry-attempts 2 \
  --timeout-ms 30000 \
  --memory ./out/deepseek-memory.jsonl \
  --include-plugins \
  --out ./out/deepseek-patch
```

Add a review pass when you have a character glossary:

```bash
node dist/cli/index.js run ./game \
  --provider deepseek \
  --model deepseek-chat \
  --target ru \
  --characters ./out/characters.json \
  --review \
  --out ./out/deepseek-reviewed-patch
```

## Manual Pipeline

Use the manual pipeline when you want to inspect or edit each phase.

```bash
node dist/cli/index.js detect ./game

node dist/cli/index.js extract ./game \
  --include-plugins \
  --out ./work/units.json

node dist/cli/index.js translate ./work/units.json \
  --provider deepseek \
  --model deepseek-chat \
  --target ru \
  --batch-size 10 \
  --retry-attempts 2 \
  --timeout-ms 30000 \
  --memory ./work/translation-memory.jsonl \
  --out ./work/translations.raw.json

node dist/cli/index.js characters ./work/units.json \
  --translations ./work/translations.raw.json \
  --provider deepseek \
  --model deepseek-chat \
  --target ru \
  --out ./work/characters.json

node dist/cli/index.js review ./work/units.json ./work/translations.raw.json \
  --provider deepseek \
  --model deepseek-chat \
  --target ru \
  --characters ./work/characters.json \
  --out ./work/translations.reviewed.json

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
```

If the report contains validation errors, fix or repair translations before applying
the patch. The `run` command applies only translations without validation errors.

After `repair`, run `validate` again and apply the repaired file when the report is
acceptable:

```bash
node dist/cli/index.js validate ./work/units.json ./work/translations.repaired.json \
  --out ./work/report.repaired.json

node dist/cli/index.js apply ./game ./work/translations.repaired.json \
  --mode patch \
  --include-plugins \
  --out ./work/patch
```

## Fonts

RPG Maker MZ games may need a font that supports the target language.

```bash
node dist/cli/index.js apply ./game ./work/translations.reviewed.json \
  --mode patch \
  --out ./work/patch \
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

## Development

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The core logic is provider-independent. New engines and providers should be added
through adapters rather than by coupling provider code to extract/apply logic.
