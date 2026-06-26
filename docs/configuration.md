# Configuration

A long DeepSeek run needs many flags. To avoid repeating them, put defaults in a
project config file.

## Loading

- With no `--config`, the CLI loads `rpgm-ai-translator.json` from the current
  working directory if it exists. A missing default file is not an error.
- With `--config <file>`, that file is loaded instead; a missing or malformed
  `--config` file is an error.

## Precedence

```text
command-line flag  >  config file  >  built-in default
```

A config value is only applied when the matching flag is absent from the command
line, so an explicit flag always wins. Config affects only the commands that
accept the corresponding flag (for example, `provider` is ignored by `detect`).

`out` is special: it names a different artifact for each command — `extract`
writes `units.json`, `validate` a report, `translate`/`review`/`repair` a
translations file, and `run`/`apply` a patch directory. To stop a single config
value from silently redirecting an unrelated command's output, config `out` is
injected only into `run`, `apply`, and `patch-font` (where it consistently means
the patch directory). For the manual pipeline commands, pass `--out` explicitly
per step.

Boolean options can be enabled from config (`"review": true`) but there is no
`--no-*` form, so config cannot turn a boolean off — omit it or set `false`.

## Validation

Each key is checked against the type in the table below; a wrong value (for
example `"batchSize": "x"`) fails with an error naming the file and key rather
than surfacing later as an opaque flag error. `repairCodes` entries are checked
against the known validation issue codes. Unknown top-level keys (a likely typo,
such as `temprature`) are ignored with a warning on stderr. A `null` value is
treated as absent.

## Keys

Keys mirror the CLI flag names (camelCase). All are optional.

| Key | Flag | Type |
| --- | --- | --- |
| `provider` | `--provider` | string |
| `baseUrl` | `--base-url` | string |
| `apiDialect` | `--api-dialect` | string (`deepseek` / `openai` / `auto`) |
| `model` | `--model` | string |
| `target` | `--target` | string |
| `batchSize` | `--batch-size` | number |
| `timeoutMs` | `--timeout-ms` | number |
| `temperature` | `--temperature` | number |
| `maxTokens` | `--max-tokens` | number |
| `maxTokensBudget` | `--max-tokens-budget` | number |
| `retryAttempts` | `--retry-attempts` | number |
| `concurrency` | `--concurrency` | number |
| `out` | `--out` | string (only `run`/`apply`/`patch-font`) |
| `workDir` | `--work-dir` | string |
| `memory` | `--memory` | string |
| `glossary` | `--glossary` | string |
| `characters` | `--characters` | string |
| `repairAttempts` | `--repair-attempts` | number |
| `repairCodes` | `--repair-codes` | string or string[] |
| `font` | `--font` | string |
| `numberFont` | `--number-font` | string |
| `mode` | `--mode` | string |
| `backup` | `--backup` | string |
| `dialogueMaxLength` | `--dialogue-max-length` | number |
| `includeComments` | `--include-comments` | boolean |
| `includePlugins` | `--include-plugins` | boolean |
| `includeSpeakerNames` | `--include-speaker-names` | boolean |
| `review` | `--review` | boolean |
| `repair` | `--repair` | boolean |

`repairCodes` may be a comma-separated string or an array of strings.

## Example

```json
{
  "provider": "deepseek",
  "model": "deepseek-v4-flash",
  "target": "ru",
  "batchSize": 10,
  "includePlugins": true,
  "review": true,
  "repair": true,
  "repairCodes": ["MAX_LENGTH_EXCEEDED", "MISSING_TRANSLATION"],
  "memory": "./work/translation-memory.jsonl",
  "workDir": "./work"
}
```

With this file present, the run below picks up provider, model, target, batch
size, extraction and review/repair settings from config, and only overrides the
target on the command line:

```bash
node dist/cli/index.js run ./game --out ./out/patch --target en
```

## Related configuration

- The API key is read from the `DEEPSEEK_API_KEY` environment variable, never
  from the config file. Do not commit keys or `.env` files.
- Glossary (`--glossary`) and character glossary (`--characters`) are separate
  JSON files; see [examples/glossary.json](../examples/glossary.json) and
  [examples/characters.json](../examples/characters.json).
