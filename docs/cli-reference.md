# CLI Reference

This page lists every command and option. The built-in help is the authoritative,
always-current source — run `rpgm-ai-translator --help` or
`rpgm-ai-translator <command> --help` (per-command help is generated from the same
option schema the CLI validates against).

Invocation from source is `node dist/cli/index.js <command> ...`; after install it
is `rpgm-ai-translator <command> ...`.

## Global options

Accepted by every command:

- `--config <file>` — load defaults from a project config file. When omitted,
  `./rpgm-ai-translator.json` is used if present. Command-line flags override
  config values, which override built-in defaults. See
  [configuration.md](configuration.md).
- `--verbose` — on failure, print the error stack and full `cause` chain instead
  of just the message.
- `--help`, `-h` — print help for the command (or global help with no command).

Unknown options are rejected with a "did you mean" suggestion; an option missing
its value, or a duplicated value option, is also rejected.

## Option vocabulary

| Option | Meaning |
| --- | --- |
| `--out <path>` | Output file or directory, depending on the command. |
| `--work-dir <dir>` | Directory for `run` intermediates (default `<out>-work`). |
| `--report <file>` | Write (validate/extract) or read (apply/repair) a validation report. |
| `--units <file>` | Use saved units instead of re-extracting (apply). |
| `--translations <file>` | Translations JSON used as context (characters). |
| `--checkpoint <file>` | JSONL checkpoint to resume from and append to. |
| `--memory <file>` | JSONL translation memory reused across runs. |
| `--glossary <file>` | Glossary JSON for prompts and validation. |
| `--characters <file>` | Character glossary JSON for review/repair. |
| `--provider <name>` | `mock` or `deepseek`. `characters` also accepts `none` for a heuristic glossary (like `--draft-only`); other commands reject `none`. |
| `--base-url <url>` | Override the provider base URL (OpenAI-compatible endpoints). |
| `--target <lang>` | Target language code. Default `ru`. |
| `--model <name>` | Provider model name. |
| `--batch-size <n>` | Units per provider request. Default `20`. |
| `--timeout-ms <n>` | Provider request timeout. Default `60000`. |
| `--temperature <n>` | Sampling temperature `0..2`. DeepSeek default `0.3`. |
| `--max-tokens <n>` | Output token limit. DeepSeek default `8192`, or `32000` for the reasoning review/repair passes. |
| `--max-tokens-budget <n>` | Abort the run if estimated or used tokens exceed this budget. |
| `--retry-attempts <n>` | Provider retries for a failed batch. Default `2`. |
| `--codes <list>` | Comma-separated validation issue codes to repair (`repair`). |
| `--attempts <n>` | Repair passes (`repair`). Default `1`. |
| `--repair-codes <list>` | Issue codes to repair (`run --repair`). |
| `--repair-attempts <n>` | Repair passes (`run --repair`). Default `1`. |
| `--mode <patch\|in-place>` | Apply mode. Default `patch`. |
| `--backup <dir>` | Backup directory for in-place mode. |
| `--font <file>` | Main RPG Maker MZ font to copy into the patch. |
| `--number-font <file>` | MZ number font; defaults to `--font`. |
| `--dialogue-max-length <n>` | Per-line dialogue width limit in display cells. Default `52`. |
| `--include-comments` | Extract event comments. |
| `--include-plugins` | Extract cautious plugin parameters and selected plugin command text. |
| `--include-speaker-names` | Translate Show Text speaker name fields. |
| `--draft-only` | Build a heuristic character glossary without a provider. |
| `--include-mentions` | Include dialogue name mentions as character candidates. |
| `--review` | Run a second-pass review (`run`). |
| `--repair` | Enable validation-targeted repair (`run`). |
| `--dry-run` | Report what would be written without writing it. |

## Commands

### `detect <game>`

Detect the RPG Maker engine and project paths and print them as JSON. No options.
Data-only projects (a `data/` folder with no JS runtime) are detected at medium
confidence by inferring the engine from `System.json`.

### `extract <game> [options]`

Extract translation units from RPG Maker JSON data. Writes to `--out` or prints
to stdout. Options: `--out`, `--report`, `--dialogue-max-length`,
`--include-comments`, `--include-plugins`, `--include-speaker-names`.

### `translate <units.json> [options]`

Translate extracted units. With `--out` set and `--checkpoint` omitted, a
checkpoint path is derived from `--out` (`x.json` → `x.jsonl`). Options:
`--provider`, `--base-url`, `--target`, `--model`, `--batch-size`, `--timeout-ms`,
`--temperature`, `--max-tokens`, `--max-tokens-budget`, `--retry-attempts`,
`--out`, `--checkpoint`, `--report`, `--memory`, `--glossary`.

### `characters <units.json> [options]`

Generate a character glossary draft (`--draft-only`, no provider) or a
provider-inferred glossary. Translations are passed with `--translations`, not as
a positional argument. Options: `--out` (required), `--translations`,
`--provider`, `--base-url`, `--target`, `--model`, `--batch-size`, `--timeout-ms`,
`--temperature`, `--max-tokens`, `--draft-only`, `--include-mentions`.

### `review <units.json> <translations.json> [options]`

Review translated dialogue and choices using map/event context (a reasoning pass).
Options: `--provider`, `--base-url`, `--target`, `--model`, `--batch-size`,
`--timeout-ms`, `--temperature`, `--max-tokens`, `--out` (required),
`--checkpoint`, `--glossary`, `--characters`.

### `validate <units.json> <translations.json> [options]`

Validate translations and write a JSON report. Options: `--out`, `--glossary`.

### `repair <units.json> <translations.json> --report <file> --out <file> [options]`

Repair translations referenced by a validation report; revalidates after each
attempt and rejects a fix that introduces a new error. Options: `--report`
(required), `--out` (required), `--provider`, `--base-url`, `--target`, `--model`,
`--batch-size`, `--timeout-ms`, `--temperature`, `--max-tokens`, `--checkpoint`,
`--glossary`, `--characters`, `--codes`, `--attempts`.

### `apply <game> <translations.json> --out <dir> [options]`

Apply translations to a patch folder (or in-place with a backup). With `--units`,
apply uses the exact saved units (recommended); without it, the game is
re-extracted and a loud warning is printed if most ids no longer match. With
`--report`, translations with validation errors are skipped. Options: `--mode`,
`--out`, `--backup`, `--font`, `--number-font`, `--report`, `--units`,
`--include-plugins`, `--include-speaker-names`, `--dry-run`. `--font`/`--number-font`
apply only in `--mode patch` together with `--out`.

### `patch-font <game> --out <dir> --font <file> [options]`

Patch RPG Maker MZ font settings into an output folder. Options: `--out`
(required), `--font` (required), `--number-font`.

### `run <game> --out <dir> [options]`

Full pipeline: detect, extract, translate, optional review, validate, optional
repair, apply, optional font patch. `run` always writes a patch, so `--mode` and
`--backup` are ignored (a warning is printed if passed). Intermediates go to
`--work-dir` (default `<out>-work`). Options: `--out` (required), `--work-dir`,
`--provider`, `--base-url`, `--target`, `--model`, `--batch-size`, `--timeout-ms`,
`--temperature`, `--max-tokens`, `--max-tokens-budget`, `--retry-attempts`,
`--memory`, `--glossary`, `--characters`, `--repair-attempts`, `--repair-codes`,
`--font`, `--number-font`, `--dialogue-max-length`, `--include-comments`,
`--include-plugins`, `--include-speaker-names`, `--review`, `--repair`,
`--dry-run`. `--codes` and `--attempts` are accepted as aliases for
`--repair-codes` and `--repair-attempts`.

`run` holds an exclusive lock on the work directory (a `.rpgm-run.lock` file) for
the whole run, so a second run sharing the same `--work-dir` fails fast instead of
corrupting shared checkpoints and memory. The lock is released on exit and on
`Ctrl-C`/`SIGTERM`; a lock left by a crashed run is reclaimed automatically. If a
run reports the directory is in use when none is, delete the lock file.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success. |
| `1` | A usage error, a runtime failure, a `translate`/`run` that produced no translations at all (for example a total provider outage), or an `apply` (without `--units`) that skipped at least half of its translations because their ids did not match the re-extracted units. |
| `2` | Apply-blocking validation errors remain: `validate` found them, or `run`/`repair` could not resolve them. The report and any patch are still written, but the affected translations were dropped from the patch. |

## Environment

- `DEEPSEEK_API_KEY` — required when using `--provider deepseek`.
