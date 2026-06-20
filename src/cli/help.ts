export function helpText(): string {
  return `rpgm-ai-translator 0.1.2
AI-assisted translation pipeline for RPG Maker MV/MZ games.

Usage:
  rpgm-ai-translator <command> [arguments] [options]
  rpgm-ai-translator --help

Commands:
  detect <game>
      Detect RPG Maker engine and project paths.

  extract <game>
      Extract translation units from RPG Maker JSON data.

  translate <units.json>
      Translate extracted units through a provider.

  characters <units.json>
      Generate a character glossary draft or provider-inferred glossary.

  review <units.json> <translations.json>
      Review translated dialogue and choices using map/event context.

  validate <units.json> <translations.json>
      Validate translations and write a JSON report.

  repair <units.json> <translations.json>
      Repair translations referenced by a validation report.

  apply <game> <translations.json>
      Apply translations to a patch folder or in-place with backup.

  patch-font <game>
      Patch RPG Maker MZ font settings in an output folder.

  run <game>
      Run the full pipeline: detect, extract, translate, validate, apply.

Common options:
  --out <path>
      Output file or output directory, depending on the command.

  --provider <name>
      Translation provider: mock, deepseek, or none where supported.

  --model <name>
      Provider model name, for example deepseek-v4-flash.

  --target <lang>
      Target language code or name. Default: ru.

  --glossary <file>
      Load glossary JSON for prompts and validation.

  --characters <file>
      Load character glossary JSON for review or repair.

  --batch-size <n>
      Number of translation units per provider request. Default: 20.

  --timeout-ms <n>
      Provider request timeout in milliseconds. Default: 60000.

  --retry-attempts <n>
      Number of CLI-level retries for failed translate batches. Default: 1.

Extraction options:
  --include-comments
      Extract event comments. Disabled by default.

  --include-plugins
      Extract cautious plugin parameters and selected plugin command text.

  --include-speaker-names
      Translate Show Text speaker name fields. Disabled by default because
      many portrait plugins use speaker names as technical lookup keys.

Translation options:
  --memory <file>
      JSONL translation memory. Reuses matching source hashes.

  --checkpoint <file>
      JSONL checkpoint for translate, review, and repair. Existing translated
      entries are reused; new batch results are appended after each completed
      batch.

  If --out is set and --checkpoint is omitted, translate/review/repair write a
  fresh checkpoint next to --out. Example: translations.raw.json -> translations.raw.jsonl.

Validation and repair options:
  --report <file>
      Write or read a validation report, depending on the command.

  --codes <list>
      Comma-separated validation issue codes for repair.
      Example: MAX_LENGTH_EXCEEDED,MISSING_TRANSLATION

  --attempts <n>
      Number of repair passes for the repair command. Default: 1.

  --repair
      Enable validation-targeted repair in the run command.

  --repair-attempts <n>
      Number of repair passes for run --repair. Default: 1.

  --repair-codes <list>
      Comma-separated validation issue codes for run --repair.

Apply and font options:
  --mode <patch|in-place>
      Apply mode. Default: patch.

  --units <file>
      Use saved translation units when applying translations. This avoids
      re-extracting units with different extraction flags.

  --backup <dir>
      Backup directory for in-place mode.

  --font <file>
      Main RPG Maker MZ font file to copy into the patch.

  --number-font <file>
      RPG Maker MZ number font. Defaults to --font when omitted.

Examples:
  rpgm-ai-translator detect ./game

  rpgm-ai-translator extract ./game \\
      --include-plugins \\
      --out ./work/units.json

  rpgm-ai-translator translate ./work/units.json \\
      --provider deepseek \\
      --model deepseek-v4-flash \\
      --target ru \\
      --batch-size 10 \\
      --checkpoint ./work/translations.raw.checkpoint.jsonl \\
      --out ./work/translations.raw.json

  rpgm-ai-translator validate ./work/units.json ./work/translations.raw.json \\
      --out ./work/report.json

  rpgm-ai-translator repair ./work/units.json ./work/translations.raw.json \\
      --report ./work/report.json \\
      --provider deepseek \\
      --codes MAX_LENGTH_EXCEEDED,MISSING_TRANSLATION \\
      --attempts 2 \\
      --checkpoint ./work/translations.repaired.checkpoint.jsonl \\
      --out ./work/translations.repaired.json

  rpgm-ai-translator apply ./game ./work/translations.repaired.json \\
      --mode patch \\
      --units ./work/units.json \\
      --report ./work/report.json \\
      --out ./translated-patch

Environment:
  DEEPSEEK_API_KEY
      Required when using --provider deepseek.

Notes:
  Patch mode never modifies the original game directory.
  Generated checkpoints, reports, and memory files may contain proprietary text.
`;
}
