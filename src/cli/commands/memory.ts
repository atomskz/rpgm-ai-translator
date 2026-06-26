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

import { JsonlTranslationMemory } from "../../core/memory/public-api.js";
import { readOption, readPositionals, requireOption, UsageError } from "../options/public-api.js";
import type { CliIO } from "../types.js";

// Operate on the JSONL translation memory directly: report its size, compact away
// superseded lines, or prune stale/by-provider entries — so a long-lived memory
// file stays a manageable, durable asset instead of growing unbounded.
export async function memoryCommand(args: string[], io: CliIO): Promise<number> {
  const subcommand = readPositionals(args)[0];
  if (subcommand !== "stats" && subcommand !== "compact" && subcommand !== "prune") {
    throw new UsageError("Usage: memory stats | memory compact | memory prune --memory <file> [filters]");
  }
  const memoryPath = requireOption(args, "--memory");
  const memory = new JsonlTranslationMemory(memoryPath);

  if (subcommand === "stats") {
    const stats = await memory.stats();
    io.stdout(`${JSON.stringify(stats, null, 2)}\n`);
    io.stderr(
      `Memory '${memoryPath}': ${stats.liveEntries} live entr${stats.liveEntries === 1 ? "y" : "ies"}, ` +
        `${stats.supersededLines} superseded line(s), ${stats.bytes} byte(s).\n`
    );
    return 0;
  }

  if (subcommand === "compact") {
    const reclaimed = await memory.compact();
    io.stderr(`Compacted '${memoryPath}': removed ${reclaimed} superseded line(s).\n`);
    return 0;
  }

  return pruneMemory(memory, memoryPath, args, io);
}

async function pruneMemory(
  memory: JsonlTranslationMemory,
  memoryPath: string,
  args: string[],
  io: CliIO
): Promise<number> {
  const before = readOption(args, "--before");
  const model = readOption(args, "--model");
  const provider = readOption(args, "--provider");
  // Refuse a filter-less prune so a slip cannot wipe the whole memory; require at
  // least one criterion. Filters are combined with AND (the narrowest deletion).
  if (before == null && model == null && provider == null) {
    throw new UsageError("memory prune needs at least one filter: --before <ISO date>, --model <name>, or --provider <name>.");
  }
  let beforeMs: number | undefined;
  if (before != null) {
    beforeMs = Date.parse(before);
    if (Number.isNaN(beforeMs)) {
      throw new UsageError(`--before must be an ISO date or timestamp; got '${before}'.`);
    }
  }

  const removed = await memory.prune((entry) => {
    if (model != null && entry.model !== model) {
      return false;
    }
    if (provider != null && entry.provider !== provider) {
      return false;
    }
    if (beforeMs != null) {
      const updated = Date.parse(entry.updatedAt);
      if (Number.isNaN(updated) || updated >= beforeMs) {
        return false;
      }
    }
    return true;
  });
  io.stderr(`Pruned '${memoryPath}': removed ${removed} entr${removed === 1 ? "y" : "ies"}.\n`);
  return 0;
}
