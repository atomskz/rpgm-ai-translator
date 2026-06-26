# rpgm-ai-translator 0.1.9

**Phase 3 — Expand architecture.** This release reshapes the provider and engine
internals so new adapters are cheap to add, hardens the patch writer, fixes display
measurement, and adds two tools plus release engineering. No breaking changes to
the existing CLI.

## Highlights

- **Provider platform.** A new provider-neutral `openai-chat` base owns the shared
  degradation logic, and a registry replaces the hardcoded provider list — adding
  an OpenAI-shaped provider is now one small subclass plus one registry entry.
- **Reasoning by model capability.** `--thinking on|off|auto` (default `auto`):
  the review pass reasons only for a reasoning-capable model, so a plain chat model
  no longer pays the 32k token ceiling or loses `temperature` on review.
- **Local / OpenAI-compatible endpoints.** Errors now name the configured host
  (not always "DeepSeek"), and responses parse more tolerantly (legacy `text`
  field, reasoning-as-truncation).
- **Engine platform.** Commands resolve the engine through a registry, so a new
  engine is a sibling adapter, not an edit in every command.
- **Patch-safety hardening.** Byte-exact backups, a patch-side symlink re-check at
  write time, and a guard against a non-empty `--backup` directory.

## New commands

| Command | What it does |
|---|---|
| `glossary extract <units.json>` | Draft a glossary by mining frequently recurring proper nouns (mode `keep`), as an editable starting point. |
| `glossary check <glossary.json>` | Lint a glossary — structure, empty keys, case-duplicate terms — exiting non-zero on a problem. |
| `verify <game> <patch-dir>` | Check a written patch against the game: re-parse each file and confirm it structurally matches (no orphan files), exiting non-zero on any mismatch. |

## Added

- `--thinking on|off|auto` (config `thinking`) to control DeepSeek reasoning by
  model capability rather than only by pass.
- `glossary` (`extract` / `check`) and `verify` commands (above).
- A one-line ownership/distribution reminder on `run` and `apply` (to stderr).
- A tag-triggered release workflow that publishes to npm with provenance, gated on
  the verify matrix and a tag/version match.
- Governance docs: `SECURITY.md`, `CONTRIBUTING.md`, and GitHub issue/PR templates.

## Fixed

- Name the configured endpoint in provider error messages (e.g.
  `localhost:11434 API error 500: …`) instead of always saying "DeepSeek".
- Parse a generic OpenAI-compatible response more tolerantly (legacy `text` field;
  empty content + a reasoning field treated as raise-`--max-tokens` truncation).
- Back up an in-place original byte-for-byte with `copyFile`, so a non-UTF-8 file
  (e.g. a legacy Shift-JIS `plugins.js`) is preserved exactly.
- Re-check a patch file's parent directory resolves inside the output directory
  before writing, defeating a directory symlink planted under `--out`.
- Refuse a non-empty explicit `--backup` directory (the rename-swap would discard
  its contents).
- Measure combining marks and zero-width formatting controls as zero display
  width, so length validation no longer over-counts combining-diacritic text.

## Internal

- Extract `providers/openai-chat` (neutral base + `PROVIDERS` registry); DeepSeek
  is now a thin dialect.
- Resolve the engine through `engines/registry.ts` (`detectEngine`).
- Hoist the database field map to one `DATABASE_ARRAY_FIELDS` constant with a
  schema-coverage test.
- New tests for the provider degradation contract, the engine registry, schema
  coverage, byte-exact/symlink/backup patch safety, and display-width /
  number-canonicalization edges. **525 tests pass** (typecheck, lint, build,
  pack:check all green).

## Install

```bash
npm install -g rpgm-ai-translator@0.1.9
# or from the attached tarball:
npm install -g ./rpgm-ai-translator-0.1.9.tgz
```

Requires Node 20.19+. Set `DEEPSEEK_API_KEY` (or point `--base-url` at a local
OpenAI-compatible endpoint). See the README and `docs/tutorial.md` to translate
your first game.
