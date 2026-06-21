import { applyFontPatch } from "../../core/font-patch/index.js";
import { readFontOptions, requireArg, requireOption } from "../options.js";
import type { CliIO } from "../types.js";

export async function patchFontCommand(args: string[], io: CliIO): Promise<number> {
  const projectPath = requireArg(args[0], "project path");
  const outDir = requireOption(args, "--out");
  const fontPath = requireOption(args, "--font");
  const { numberFontPath } = readFontOptions(args);
  const result = await applyFontPatch(projectPath, outDir, { fontPath, numberFontPath });
  io.stdout(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}
