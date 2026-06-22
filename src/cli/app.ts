import { applyCommand } from "./commands/apply.js";
import { charactersCommand } from "./commands/characters.js";
import { detectCommand } from "./commands/detect.js";
import { extractCommand } from "./commands/extract.js";
import { patchFontCommand } from "./commands/patch-font.js";
import { repairCommand } from "./commands/repair.js";
import { reviewCommand } from "./commands/review.js";
import { runCommand } from "./commands/run.js";
import { translateCommand } from "./commands/translate.js";
import { validateCommand } from "./commands/validate.js";
import { helpText } from "./help.js";
import { validateCommandArgs } from "./options.js";
import type { CliIO, CommandHandler } from "./types.js";

export type { CliIO } from "./types.js";
export { helpText } from "./help.js";

const COMMANDS = new Map<string, CommandHandler>([
  ["detect", detectCommand],
  ["extract", extractCommand],
  ["translate", translateCommand],
  ["characters", charactersCommand],
  ["review", reviewCommand],
  ["validate", validateCommand],
  ["repair", repairCommand],
  ["apply", applyCommand],
  ["patch-font", patchFontCommand],
  ["run", runCommand]
]);

export async function runCli(argv: string[], io: CliIO = defaultIO): Promise<number> {
  const [command, ...args] = argv;

  try {
    if (!command || command === "--help" || command === "-h" || command === "help") {
      io.stdout(helpText());
      return 0;
    }

    const handler = COMMANDS.get(command);
    if (!handler) {
      io.stderr(`Unknown command: ${command}\n\n${helpText()}`);
      return 1;
    }

    validateCommandArgs(command, args);
    return await handler(args, io);
  } catch (error: unknown) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

const defaultIO: CliIO = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text)
};
