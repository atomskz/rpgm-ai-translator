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

import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROJECT_CONFIG_FILENAME } from "../../config/public-api.js";
import { pathExists, writeFileAtomic } from "../../core/utils/fs.js";
import { hasFlag, readOption, UsageError } from "../options/public-api.js";
import type { CliIO } from "../types.js";

// Minimal, safe defaults. No API key (that is env-only) and no glossary/characters
// keys (the copied example files are starting points the user opts into), so a
// fresh scaffold never silently applies example terms to a real run.
const SCAFFOLD_CONFIG = {
  provider: "deepseek",
  model: "deepseek-v4-flash",
  target: "ru",
  workDir: "./work",
  review: true,
  repair: true
};

// Written as .env.example, never .env: the real key must be set by the user in a
// gitignored .env and is never scaffolded with a value.
const ENV_EXAMPLE = [
  "# Copy this file to .env (gitignored) and fill in your key.",
  "# Never commit a real key.",
  "DEEPSEEK_API_KEY=",
  ""
].join("\n");

// Example glossary/characters shipped with the package, copied next to the config
// as editable starting points. Resolved relative to this module so it works from
// both src (tests) and dist (installed) — the depth to the package root is the same.
const EXAMPLE_FILES = ["glossary.json", "characters.json"] as const;

function exampleSourcePath(name: string): string {
  return fileURLToPath(new URL(`../../../examples/${name}`, import.meta.url));
}

export async function initCommand(args: string[], io: CliIO): Promise<number> {
  const configPath = readOption(args, "--out") ?? PROJECT_CONFIG_FILENAME;
  const force = hasFlag(args, "--force");
  const targetDir = path.dirname(path.resolve(configPath));

  // The config file is the gate: refuse to clobber an existing project setup
  // unless --force, so re-running init does not wipe hand-edited settings.
  if (!force && (await pathExists(configPath))) {
    throw new UsageError(
      `'${configPath}' already exists. Pass --force to overwrite the scaffold, or use --out to write elsewhere.`
    );
  }

  await mkdir(targetDir, { recursive: true });
  const created: string[] = [];

  await writeFileAtomic(configPath, `${JSON.stringify(SCAFFOLD_CONFIG, null, 2)}\n`);
  created.push(configPath);

  const envPath = path.join(targetDir, ".env.example");
  if (force || !(await pathExists(envPath))) {
    await writeFile(envPath, ENV_EXAMPLE, "utf8");
    created.push(envPath);
  }

  for (const name of EXAMPLE_FILES) {
    const dest = path.join(targetDir, name);
    if (!force && (await pathExists(dest))) {
      continue;
    }
    try {
      await copyFile(exampleSourcePath(name), dest);
      created.push(dest);
    } catch {
      // The example files are optional onboarding aids; if they are not present
      // (an unusual install layout) the scaffold still succeeds without them.
    }
  }

  // The created paths are the machine-useful output (stdout); the next-step hint is
  // human guidance (stderr), so a piped stdout stays a clean list of files.
  io.stdout(`${created.join("\n")}\n`);
  io.stderr(
    `Scaffolded ${created.length} file(s). Next: copy .env.example to .env and set DEEPSEEK_API_KEY, ` +
      "then run 'rpgm-ai-translator run ./your-game --out ./out/patch'.\n"
  );
  return 0;
}
