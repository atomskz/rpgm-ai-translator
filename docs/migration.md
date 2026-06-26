# CLI changes and migration

This records the user-visible CLI changes since `0.1.7`, so a script or muscle-memory
built on an older version keeps working (or fails loudly with a clear message).
None of these require a change to existing commands unless noted; deprecated forms
still work for now.

## New commands

| Command | Purpose |
| --- | --- |
| `init` | Scaffold `rpgm-ai-translator.json`, `.env.example`, example glossary/characters. |
| `doctor [game]` | Preflight provider/key/game and send one probe request before paid spend. |
| `config validate \| print [command]` | Validate the project config, or print it / the flags it injects. |
| `memory stats \| compact \| prune` | Inspect, compact, or prune the JSONL translation memory. |
| `report summarize <report.json>` | Render the validation report as a Markdown review document. |
| `diff <raw> <reviewed> [repaired]` | Per-unit before/after across the translate/review/repair passes. |
| `estimate <units.json>` | Batch count and token/USD estimate for a units file. |
| `status <game> --out <dir>` | Resumability inspection: counts, signature, resume vs reset. |
| `clean --out <dir>` | Remove work-dir checkpoints/lock (and optionally memory). |

## Renamed / aliased flags (old form still works)

| Command | Old form | New form | Notes |
| --- | --- | --- | --- |
| `characters` | `--translations <file>` | `characters <units.json> <translations.json>` | Translations is now an optional second positional; `--translations` is a deprecated alias. |
| `repair` | `--codes` / `--attempts` | also `--repair-codes` / `--repair-attempts` | The run-style names (and the `repairCodes`/`repairAttempts` config keys) now reach standalone `repair`. |

## New flags

| Flag | Commands | Meaning |
| --- | --- | --- |
| `--api-dialect <deepseek\|openai\|auto>` | translate/review/repair/characters/run/doctor | Request shape; `openai` for a custom `--base-url` (auto). |
| `--concurrency <n>` | translate, run | Translation batches in flight at once (default 1). |
| `--include-notes` | extract, run, apply | Extract the database `note` field (off by default). |
| `--from-translations <file>` | run | Seed a resumed run's checkpoint from a hand-edited translations file. |
| `--price-per-1k <usd>` | estimate, run (dry run) | Optional USD cost band. |
| `--force` | apply, run | Overwrite a non-empty patch `--out`. |

## Behavior changes

| Change | Before | After | Migration |
| --- | --- | --- | --- |
| Config `out` scope | Injected into every command | Injected only into `run`/`apply`/`patch-font`/`status`/`clean` | Pass `--out` explicitly to the manual-pipeline commands (extract/translate/validate/review/repair/characters). |
| `--target` echo | Silent default `ru` | Echoed on every translating command; `run` warns when defaulted | None; pass `--target` to silence the warning. |
| Non-empty patch `--out` | Silently overlaid | Refused unless `--force` (or same game re-run) | Use a fresh `--out`, or pass `--force`. |
| `apply --font` outside patch mode | Silent no-op | Usage error | Use `--mode patch --out <dir>` (or `patch-font`). |
| `apply --dialogue-max-length` with `--units` | Silent no-op | Warning (constraints come from the units file) | Drop the flag when passing `--units`. |
| `detect` on a non-game | Exit 0 | Exit non-zero (JSON still printed) | A wrapper can now branch on `$?`. |
| Scroll text (405) length | 52-cell dialogue budget (spurious `MAX_LENGTH`) | No per-line width limit | None. |
| Resume signature | Language/model/provider/glossary | Also game identity, sampling, extraction flags, and prompt version | A one-time reset on the next run after upgrading; then resumes normally. |

## New config keys

`apiDialect`, `concurrency`, `includeNotes` (mirroring the flags above). The
`out` key is now scoped (see the table). See
[docs/configuration.md](configuration.md) for the full list.
