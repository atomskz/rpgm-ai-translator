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
