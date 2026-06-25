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

import type { BatchFailureSummary, TranslateOptions } from "../core/types/public-api.js";
import type { CliIO } from "./types.js";

// Trim long provider messages so a failure summary stays a single tidy line.
const MAX_REASON_MESSAGE = 160;

// Append a per-cause breakdown beneath a batch line when units failed, so the
// user sees why (auth, network, schema...) without opening the report JSON.
function failureReasonLines(failures: BatchFailureSummary[] | undefined): string {
  if (!failures || failures.length === 0) {
    return "";
  }
  return failures
    .map((failure) => {
      const message =
        failure.message.length > MAX_REASON_MESSAGE
          ? `${failure.message.slice(0, MAX_REASON_MESSAGE - 1)}…`
          : failure.message;
      return `  - ${failure.code} (${failure.count}): ${message}\n`;
    })
    .join("");
}

export function createProgressLogger(io: CliIO): NonNullable<TranslateOptions["onProgress"]> {
  let memoryHits = 0;
  return (event) => {
    if (event.type === "memory-hit") {
      memoryHits += 1;
      if (memoryHits === 1 || memoryHits % 100 === 0) {
        io.stderr(`Memory hits: ${memoryHits}/${event.total}\n`);
      }
      return;
    }

    if (event.type === "batch-start") {
      io.stderr(
        `Translating batch ${event.batchIndex}/${event.batchCount} (${event.batchSize} units, completed ${event.completed}/${event.total})...\n`
      );
      return;
    }

    if (event.type === "review-batch-start") {
      io.stderr(
        `Reviewing batch ${event.batchIndex}/${event.batchCount} (${event.batchSize} units, completed ${event.completed}/${event.total})...\n`
      );
      return;
    }

    if (event.type === "review-batch-complete") {
      io.stderr(
        `Completed review batch ${event.batchIndex}/${event.batchCount}: reviewed ${event.reviewed}, failed ${event.failed}, completed ${event.completed}/${event.total}\n` +
          (event.failed > 0 ? failureReasonLines(event.failures) : "")
      );
      return;
    }

    if (event.type === "batch-retry") {
      io.stderr(
        `Retrying batch ${event.batchIndex}/${event.batchCount}, attempt ${event.attempt + 1}/${event.maxAttempts}: ${event.message}\n`
      );
      return;
    }

    io.stderr(
      `Completed batch ${event.batchIndex}/${event.batchCount}: translated ${event.translated}, failed ${event.failed}, completed ${event.completed}/${event.total}\n` +
        (event.failed > 0 ? failureReasonLines(event.failures) : "")
    );
  };
}
