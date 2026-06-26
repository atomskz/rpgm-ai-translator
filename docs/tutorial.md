# Tutorial: translate your first game

This walks through translating an RPG Maker MV/MZ game end to end, from a clean
checkout to a finished patch. It uses the bundled `examples/mz-sample` so you can
follow along without a real game; swap in your own game path when you are ready.

> Always work on a **copy** of the game. The patch is written to a separate output
> directory and never modifies the original, but keeping a backup is good practice.

## 0. Build

```bash
npm install
npm run build
```

All commands below are `node dist/cli/index.js <command>`. (On Windows, see the
[PowerShell quick start](../README.md#windows-powershell).)

## 1. Scaffold a project (optional but recommended)

```bash
node dist/cli/index.js init
```

This writes `rpgm-ai-translator.json` (provider/model/target/work dir, review and
repair on), a `.env.example`, and example `glossary.json` / `characters.json` you
can edit. Copy `.env.example` to `.env` and set your key when you use a real
provider:

```bash
DEEPSEEK_API_KEY=sk-...
```

## 2. Dry run with the mock provider

The `mock` provider does not call any API; it prefixes source text with the target
code (e.g. `[ru] Hello`), which is perfect for checking extraction and patching.

```bash
node dist/cli/index.js run ./examples/mz-sample \
  --provider mock --target ru --include-plugins \
  --out ./out/sample --dry-run
```

The dry run reports how many units would be sent (excluding memory hits), which
passes would run, and an estimate. Add `--price-per-1k 0.5` for a rough USD band.

## 3. Preflight a real provider

Before spending anything, check your key, model and endpoint:

```bash
node dist/cli/index.js doctor ./examples/mz-sample --provider deepseek --model deepseek-v4-flash
```

`doctor` exits non-zero if any check fails. (For a local model, point `--base-url`
at its `/v1` endpoint — see [Local Or OpenAI-Compatible LLM](../README.md#local-or-openai-compatible-llm---base-url).)

## 4. Run the full pipeline

```bash
node dist/cli/index.js run ./examples/mz-sample \
  --provider deepseek --model deepseek-v4-flash --target ru \
  --include-plugins --review --repair \
  --glossary ./glossary.json --characters ./characters.json \
  --out ./out/sample
```

This detects the engine, extracts units, translates (with the glossary and
character glossary in the first pass), reviews dialogue, validates, repairs the
flagged issues, and writes the patch to `./out/sample`. Intermediate artifacts go
to `./out/sample-work` (units, per-stage translations, checkpoints, memory,
report) — never into the patch folder.

A crash is safe to re-run: the same command resumes from the checkpoints. Run
`status ./examples/mz-sample --out ./out/sample` to see what would resume.

## 5. Review what each pass produced

Turn the JSON report into a readable review document:

```bash
node dist/cli/index.js report summarize ./out/sample-work/report.json \
  --units ./out/sample-work/units.json \
  --translations ./out/sample-work/translations.json \
  --out ./out/sample-work/review.md
```

See exactly what review and repair changed:

```bash
node dist/cli/index.js diff \
  ./out/sample-work/translations.raw.json \
  ./out/sample-work/translations.reviewed.json \
  ./out/sample-work/translations.json
```

## 6. Hand-edit and fold edits back in

If you correct `translations.json` by hand, re-run with `--from-translations` so
your edits are honored instead of being overwritten by the resume:

```bash
node dist/cli/index.js run ./examples/mz-sample \
  --provider deepseek --target ru --out ./out/sample \
  --from-translations ./out/sample-work/translations.json
```

## 7. Ship the patch

`./out/sample` contains only patched game files. Overlay it onto a **copy** of the
game (copy the original, then copy the patch files over it). Validate the character
glossary and check the work-dir health any time:

```bash
node dist/cli/index.js characters check ./characters.json
node dist/cli/index.js memory stats --memory ./out/sample-work/translation-memory.jsonl
```

When you are done with a run, `clean --out ./out/sample` removes the checkpoints
and lock (preserving the translation memory) so you can start fresh.

## Where to go next

- [docs/cli-reference.md](cli-reference.md) — every command and flag.
- [docs/configuration.md](configuration.md) — the project config file.
- [docs/migration.md](migration.md) — CLI changes and deprecations.
- [docs/troubleshooting.md](troubleshooting.md) — common errors and issue codes.
