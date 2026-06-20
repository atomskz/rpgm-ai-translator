import { MvMzEngineDetector } from "../../core/engine-detector/index.js";
import { requireArg } from "../options.js";
import type { CliIO } from "../types.js";

export async function detectCommand(args: string[], io: CliIO): Promise<number> {
  const projectPath = requireArg(args[0], "project path");
  const detected = await new MvMzEngineDetector().detect(projectPath);
  io.stdout(`${JSON.stringify(detected, null, 2)}\n`);
  return 0;
}
