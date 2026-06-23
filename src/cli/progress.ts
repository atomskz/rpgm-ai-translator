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

import type { TranslateOptions } from "../core/types.js";
import type { CliIO } from "./types.js";

export function createProgressLogger(io: CliIO): NonNullable<TranslateOptions["onProgress"]> {
  let memoryHits = 0;
  return (event) => {
    if (event.type === "memory-hit") {
      memoryHits += 1;
      if (memoryHits === 1 || memoryHits % 100 === 0) {
        io.stdout(`Memory hits: ${memoryHits}/${event.total}\n`);
      }
      return;
    }

    if (event.type === "batch-start") {
      io.stdout(
        `Translating batch ${event.batchIndex}/${event.batchCount} (${event.batchSize} units, completed ${event.completed}/${event.total})...\n`
      );
      return;
    }

    if (event.type === "review-batch-start") {
      io.stdout(
        `Reviewing batch ${event.batchIndex}/${event.batchCount} (${event.batchSize} units, completed ${event.completed}/${event.total})...\n`
      );
      return;
    }

    if (event.type === "review-batch-complete") {
      io.stdout(
        `Completed review batch ${event.batchIndex}/${event.batchCount}: reviewed ${event.reviewed}, failed ${event.failed}, completed ${event.completed}/${event.total}\n`
      );
      return;
    }

    if (event.type === "batch-retry") {
      io.stdout(
        `Retrying batch ${event.batchIndex}/${event.batchCount}, attempt ${event.attempt + 1}/${event.maxAttempts}: ${event.message}\n`
      );
      return;
    }

    io.stdout(
      `Completed batch ${event.batchIndex}/${event.batchCount}: translated ${event.translated}, failed ${event.failed}, completed ${event.completed}/${event.total}\n`
    );
  };
}
