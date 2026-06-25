/*
 * This file is part of rpgm-ai-translator.
 *
 * Copyright (C) 2026 Nikita Fedorov
 *
 * rpgm-ai-translator is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * rpgm-ai-translator is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with rpgm-ai-translator. If not, see <https://www.gnu.org/licenses/>.
 */

import { COMMAND_OPTION_SPECS } from "./options/public-api.js";

type CommandHelpMeta = {
  usage: string;
  summary: string;
  notes?: string[];
};

const COMMAND_HELP: Record<string, CommandHelpMeta> = {
  init: {
    usage: "init [--out <config>] [--force]",
    summary: "Scaffold a project config, .env.example and example glossary/character files.",
    notes: [
      "--out sets the config path (default: ./rpgm-ai-translator.json).",
      "--force overwrites an existing scaffold; without it init refuses to clobber your config.",
      "No API key is ever written: set DEEPSEEK_API_KEY in .env (copied from .env.example)."
    ]
  },
  doctor: {
    usage: "doctor [game] [options]",
    summary: "Preflight checks: provider config, API key, game detection, and a minimal probe request.",
    notes: ["Sends one tiny probe translation to the resolved provider/base-url/model; exits non-zero if any check fails."]
  },
  config: {
    usage: "config validate | config print [command]",
    summary: "Validate the project config, or print it (or the flags it injects into a command).",
    notes: ["config validate exits non-zero on a malformed config; config print <command> shows the effective injected flags."]
  },
  detect: { usage: "detect <game>", summary: "Detect the RPG Maker engine and project paths." },
  extract: { usage: "extract <game> [options]", summary: "Extract translation units from RPG Maker JSON data." },
  translate: { usage: "translate <units.json> [options]", summary: "Translate extracted units through a provider." },
  characters: {
    usage: "characters <units.json> [options]",
    summary: "Generate a character glossary draft or provider-inferred glossary.",
    notes: ["Pass translations with --translations (not a positional argument)."]
  },
  review: {
    usage: "review <units.json> <translations.json> [options]",
    summary: "Review translated dialogue and choices using map/event context."
  },
  validate: {
    usage: "validate <units.json> <translations.json> [options]",
    summary: "Validate translations and write a JSON report."
  },
  repair: {
    usage: "repair <units.json> <translations.json> --report <file> --out <file> [options]",
    summary: "Repair translations referenced by a validation report."
  },
  apply: {
    usage: "apply <game> <translations.json> --out <dir> [options]",
    summary: "Apply translations to a patch folder or in-place with a backup.",
    notes: ["--font and --number-font apply only in --mode patch together with --out."]
  },
  "patch-font": {
    usage: "patch-font <game> --out <dir> --font <file> [options]",
    summary: "Patch RPG Maker MZ font settings into an output folder."
  },
  run: {
    usage: "run <game> --out <dir> [options]",
    summary: "Full pipeline: detect, extract, translate, optional review, validate, optional repair, apply, optional font patch.",
    notes: [
      "run always writes a patch; --mode and --backup are ignored.",
      "--codes and --attempts are accepted as aliases for --repair-codes and --repair-attempts."
    ]
  }
};

const FLAG_DESCRIPTIONS: Record<string, string> = {
  "--out": "Output file or directory, depending on the command.",
  "--work-dir": "Directory for intermediate artifacts (default: <out>-work).",
  "--report": "Write or read a validation report, depending on the command.",
  "--units": "Use saved translation units instead of re-extracting them.",
  "--translations": "Translations JSON used as context for the character glossary.",
  "--checkpoint": "JSONL checkpoint to resume from and append batch results to.",
  "--memory": "JSONL translation memory reused across runs.",
  "--glossary": "Glossary JSON for prompts and validation.",
  "--characters": "Character glossary JSON for review or repair.",
  "--provider": "Translation provider: mock or deepseek (characters also accepts none for a heuristic glossary).",
  "--base-url": "Override the provider base URL (e.g. a local OpenAI-compatible endpoint).",
  "--api-dialect": "Request shape: deepseek, openai, or auto (default; openai for a custom --base-url).",
  "--target": "Target language code. Default: ru.",
  "--model": "Provider model name.",
  "--batch-size": "Translation units per provider request.",
  "--timeout-ms": "Provider request timeout in milliseconds.",
  "--temperature": "Provider sampling temperature (0..2). Ignored on the reasoning review/repair passes.",
  "--max-tokens": "Provider output token limit (DeepSeek: 8192, or 32000 for reasoning review/repair).",
  "--max-tokens-budget": "Abort the run if estimated or used tokens exceed this budget.",
  "--retry-attempts": "Provider retry attempts for transient failures (timeout, network, rate limit, 5xx). Default: 2.",
  "--codes": "Comma-separated validation issue codes to repair.",
  "--attempts": "Number of repair passes.",
  "--repair-codes": "Comma-separated validation issue codes for run --repair.",
  "--repair-attempts": "Number of repair passes for run --repair.",
  "--mode": "Apply mode: patch or in-place. Default: patch.",
  "--backup": "Backup directory for in-place mode.",
  "--font": "Main RPG Maker MZ font file to copy into the patch.",
  "--number-font": "RPG Maker MZ number font. Defaults to --font when omitted.",
  "--include-comments": "Extract event comments.",
  "--include-plugins": "Extract cautious plugin parameters and selected plugin command text.",
  "--include-speaker-names": "Translate Show Text speaker name fields.",
  "--dialogue-max-length": "Max display width (cells) for a dialogue line constraint. Default: 52.",
  "--draft-only": "Build a heuristic character glossary without calling a provider.",
  "--include-mentions": "Include dialogue name mentions as character candidates.",
  "--review": "Run a second-pass review of dialogue and choices.",
  "--repair": "Enable validation-targeted repair.",
  "--dry-run": "Report what would be written without creating or modifying files.",
  "--force": "Overwrite a non-empty patch output directory (refused by default to avoid mixing patches)."
};

export function commandUsage(command: string): string | undefined {
  return COMMAND_HELP[command]?.usage;
}

export function commandHelp(command: string): string {
  const meta = COMMAND_HELP[command];
  const spec = COMMAND_OPTION_SPECS[command];
  if (!meta || !spec) {
    return helpText();
  }
  const valueOptions = new Set<string>(spec.valueOptions);
  const flags = [...spec.valueOptions, ...spec.booleanFlags].sort();
  const lines = [`Usage: rpgm-ai-translator ${meta.usage}`, "", meta.summary];
  if (flags.length > 0) {
    lines.push("", "Options:");
    for (const flag of flags) {
      const label = valueOptions.has(flag) ? `${flag} <value>` : flag;
      const description = FLAG_DESCRIPTIONS[flag];
      lines.push(`  ${label}${description ? `  ${description}` : ""}`);
    }
  }
  if (meta.notes && meta.notes.length > 0) {
    lines.push("", ...meta.notes);
  }
  lines.push("", "  --config <value>  Load defaults from a project config file (default: ./rpgm-ai-translator.json).");
  lines.push("  --verbose  Print the error stack and cause chain when the command fails.");
  return `${lines.join("\n")}\n`;
}

export function helpText(): string {
  return `rpgm-ai-translator 0.1.7
AI-assisted translation pipeline for RPG Maker MV/MZ games.

Usage:
  rpgm-ai-translator <command> [arguments] [options]
  rpgm-ai-translator --help

Commands:
  init
      Scaffold a project config, .env.example and example glossary/character files.

  doctor [game]
      Preflight provider config, API key, game detection and a probe request.

  config validate | config print [command]
      Validate the project config, or print it (or the flags it injects).

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
      Run the full pipeline: detect, extract, translate, optional review,
      validate, optional repair, apply, optional font patch.

Common options:
  --out <path>
      Output file or output directory, depending on the command.

  --provider <name>
      Translation provider: mock or deepseek. The characters command also
      accepts none to build a heuristic glossary without a provider (like
      --draft-only); other commands reject none.

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

  --temperature <n>
      Provider sampling temperature. DeepSeek default: 0.3. Range: 0..2.
      Ignored on the reasoning review/repair passes (thinking enabled).

  --max-tokens <n>
      Provider output token limit. DeepSeek default: 8192, or 32000 for the
      reasoning review/repair passes (chain-of-thought counts against this).

  --retry-attempts <n>
      Provider retry attempts for transient failures (timeouts, network errors,
      rate limits, 5xx). Permanent errors (auth, billing, bad request) are not
      retried. Handled by the provider client, the single retry layer. Default: 2.

Extraction options:
  --include-comments
      Extract event comments. Disabled by default.

  --include-plugins
      Extract cautious plugin parameters and selected plugin command text.

  --include-speaker-names
      Translate Show Text speaker name fields. Disabled by default because
      many portrait plugins use speaker names as technical lookup keys.

  --dialogue-max-length <n>
      Max display width in cells for a single Show Text dialogue line. Baked
      into each dialogue unit's maxLength constraint at extraction. Defaults to
      52; raise or lower it to match the game's message font.

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
      --temperature 0.3 \\
      --max-tokens 8192 \\
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

Configuration:
  --config <file>
      Load defaults from a project config file. When omitted, ./rpgm-ai-translator.json
      is used if present. Command-line flags always override config values, and
      config values override built-in defaults. Recognized keys mirror the flag
      names (e.g. provider, model, target, out, includePlugins, review).

  --verbose
      Print the error stack and full cause chain when a command fails. Without
      it, only the human-readable error message is shown.

Environment:
  DEEPSEEK_API_KEY
      Required when using --provider deepseek.

Notes:
  Patch mode never modifies the original game directory.
  Generated checkpoints, reports, and memory files may contain proprietary text.
`;
}
