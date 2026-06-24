# Troubleshooting

Symptom → cause → fix for the most common failures. Add `--verbose` to any
command to see the full error stack and cause chain.

## "DeepSeek response was truncated at the max_tokens limit"

**Cause.** The `review` and `repair` passes use the provider's reasoning mode. A
reasoning model spends `max_tokens` on its chain-of-thought *before* emitting the
answer, so if `max_tokens` is too low the response comes back empty or with
incomplete JSON (`finish_reason: length`). This is most likely when a batch packs
many long lines (for example the long `MAX_LENGTH_EXCEEDED` lines that `repair`
targets).

**Fix.**

- Raise `--max-tokens` for the reasoning pass (the default is already `32000`,
  but very long batches can need more):

  ```bash
  node dist/cli/index.js repair ./work/units.json ./work/translations.reviewed.json \
    --report ./work/report.json --provider deepseek --model <reasoning-model> \
    --max-tokens 64000 --batch-size 5 \
    --out ./work/translations.final.json
  ```

- Lower `--batch-size` so each request reasons over fewer/shorter lines.
- The existing JSONL checkpoint means a re-run only retries the units that failed.

## "did not include message content"

A 200 response whose content is genuinely empty (no `finish_reason: length`).
Usually a transient provider hiccup — re-run (the checkpoint resumes). If it
persists, try `--verbose`, a smaller `--batch-size`, or a different `--model`.

## Provider error codes

Provider failures are reported per unit with an issue code and message:

| Code | Meaning | Retried? |
| --- | --- | --- |
| `PROVIDER_AUTH_ERROR` | Bad/missing API key (HTTP 401). | No |
| `PROVIDER_BILLING_ERROR` | Billing/quota problem (HTTP 402). | No |
| `PROVIDER_RATE_LIMIT` | Rate limited (HTTP 429); `Retry-After` is honored. | Yes |
| `PROVIDER_TIMEOUT` | Request timed out (`--timeout-ms`). | Yes |
| `PROVIDER_NETWORK_ERROR` | Socket failure (`ECONNRESET`, `ENOTFOUND`, ...). | Yes |
| `PROVIDER_SERVER_ERROR` | HTTP 5xx. | Yes |
| `PROVIDER_REQUEST_ERROR` | HTTP 400/422 (bad request, e.g. unknown model). | No |
| `PROVIDER_RESPONSE_ERROR` | Unparseable/truncated content. | No |
| `PROVIDER_RESPONSE_SCHEMA_ERROR` | Response did not match the expected shape. | No |
| `PROVIDER_RESPONSE_ID_ANOMALY` | Response was parsed but its ids did not cover the request (missing/extra/duplicate); a warning, not a blocking error. | No |

`DEEPSEEK_API_KEY` must be set for `--provider deepseek`. A `PROVIDER_REQUEST_ERROR`
on every call usually means the `--model` name is wrong for your account.

## "Output directory must be outside the game folder"

`apply`/`run` refuse a `--out` that is the game folder, is inside it, or contains
it, so the original game is never overwritten. Point `--out` at a sibling or
unrelated directory (for example `./out` next to `./game`).

## `apply` skipped most translations

Without `--units`, `apply` re-extracts the game and matches by id. If the saved
translations were produced with different extraction flags (for example
`--include-plugins`), most ids no longer match and are skipped (you will see a
warning). Pass `--units ./work/units.json` so ids match the saved units exactly.

## "Unsupported or unknown RPG Maker engine"

The folder has no `data/` (or `www/data/`) directory, or no readable
`System.json`. A data-only export (just `data/`) is supported and detected at
medium confidence; if detection still fails, confirm `System.json` is valid JSON.

## "Unknown option ... Did you mean ...?" / "... requires a value"

A flag is misspelled, unknown for that command, missing its value, or duplicated.
Run `<command> --help` for the exact accepted flags, or see
[cli-reference.md](cli-reference.md).

## `run --mode`/`--backup` seem ignored

They are. `run` always writes a patch; it prints a warning and ignores `--mode`
and `--backup`. Use the standalone `apply` command for in-place mode.

## "Another run is using ..." (work-directory lock)

`run` holds an exclusive lock on its work directory (a `.rpgm-run.lock` file) so a
second run sharing the same `--work-dir` cannot interleave checkpoint and memory
writes. The lock is released when the run finishes and on `Ctrl-C`/`SIGTERM`, and
a lock left by a crashed run is reclaimed automatically on the next start. If you
see this error when no run is active (for example after a `kill -9`), pass a
different `--work-dir` or delete the lock file.

## Validation issue codes

`validate` writes a report and the summary lists issues by code. Issues with
`severity: error` are excluded from a written patch by `run` and by `apply
--report`; warnings are reported but still applied.

- Errors include `MISSING_TRANSLATION`, `EMPTY_TRANSLATION`, the placeholder
  issues (`MISSING_PLACEHOLDER`, `EXTRA_PLACEHOLDER`, `DUPLICATE_PLACEHOLDER`),
  `CONTROL_CODE_CHANGED`, `VARIABLE_CHANGED`, `NUMBER_CHANGED`, and
  `MAX_LINES_EXCEEDED`.
- Warnings include `MAX_LENGTH_EXCEEDED` (horizontal fitting is best-effort),
  `TECHNICAL_TOKEN_CHANGED` (a `<tag>` or control code differs between source and
  translation), `UNCHANGED_TRANSLATION`, and `GLOSSARY_VIOLATION`.

Use `repair --codes <list>` to target specific codes, then re-run `validate` and
inspect the report before shipping a patch.
