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

import { MvMzEngineDetector } from "../../engines/rpgmaker-mvmz/public-api.js";
import { createProvider } from "../../providers/public-api.js";
import { readPositionals, readProviderCliOptions, readProviderConfig, readProviderName } from "../options/public-api.js";
import type { TranslationUnit } from "../../core/types/public-api.js";
import type { CliIO } from "../types.js";

type CheckResult = { ok: boolean; name: string; detail?: string };

const SUPPORTED_PROVIDERS = ["mock", "deepseek"];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// One tiny, cheap unit so the probe exercises the real request path (auth,
// base-url, model, JSON response) without spending on a full batch.
const PROBE_UNIT: TranslationUnit = {
  id: "__doctor_probe__",
  source: "OK",
  filePath: "<doctor-probe>",
  jsonPath: "0",
  engine: "rpgmaker-mz",
  category: "system",
  hash: "probe"
};

// A preflight that fails before any paid run instead of mid-run after spending:
// it checks the provider config, the API key, the game, and sends one minimal
// probe request to the resolved base-url/model. Every check runs (one failure
// does not hide the others); the command exits non-zero if any check failed.
export async function doctorCommand(args: string[], io: CliIO): Promise<number> {
  const projectPath = readPositionals(args)[0];
  const providerName = readProviderName(args);
  const providerConfig = readProviderConfig(args);
  const providerOptions = readProviderCliOptions(args);

  const checks: CheckResult[] = [];

  const supported = SUPPORTED_PROVIDERS.includes(providerName);
  checks.push({
    ok: supported,
    name: `Provider '${providerName}' is supported`,
    detail: supported ? undefined : `Supported providers: ${SUPPORTED_PROVIDERS.join(", ")}.`
  });

  let keyOk = true;
  if (providerName === "deepseek") {
    keyOk = Boolean(process.env.DEEPSEEK_API_KEY?.trim());
    checks.push({
      ok: keyOk,
      name: "DEEPSEEK_API_KEY is set",
      detail: keyOk ? undefined : "Set DEEPSEEK_API_KEY in your environment or a .env file (see init's .env.example)."
    });
  }

  if (projectPath) {
    checks.push(await checkGame(projectPath));
  }

  // Probe only when the provider can plausibly answer; a missing key or unknown
  // provider would just produce a confusing network/auth error.
  if (supported && keyOk) {
    checks.push(await probeProvider(providerName, providerConfig, providerOptions));
  } else {
    checks.push({ ok: false, name: "Provider responds to a probe request", detail: "Skipped: resolve the checks above first." });
  }

  for (const check of checks) {
    io.stdout(`${check.ok ? "PASS" : "FAIL"}  ${check.name}${check.detail ? ` — ${check.detail}` : ""}\n`);
  }
  const failed = checks.filter((check) => !check.ok).length;
  io.stderr(
    failed === 0
      ? "All preflight checks passed.\n"
      : `${failed} preflight check(s) failed. Fix them before a paid run.\n`
  );
  return failed === 0 ? 0 : 1;
}

async function checkGame(projectPath: string): Promise<CheckResult> {
  try {
    const detected = await new MvMzEngineDetector().detect(projectPath);
    const ok = detected.engine !== "unknown";
    return {
      ok,
      name: `Game at '${projectPath}' is a recognized RPG Maker project`,
      detail: ok ? `Detected ${detected.engine}.` : "Not an MV/MZ project (no data/ or System.json found)."
    };
  } catch (error: unknown) {
    return { ok: false, name: `Game at '${projectPath}' is readable`, detail: errorMessage(error) };
  }
}

async function probeProvider(
  providerName: string,
  providerConfig: ReturnType<typeof readProviderConfig>,
  providerOptions: ReturnType<typeof readProviderCliOptions>
): Promise<CheckResult> {
  try {
    const provider = createProvider(providerName, providerConfig);
    // A single attempt: a preflight wants a fast yes/no, not the full retry budget.
    const results = await provider.translateBatch([PROBE_UNIT], { ...providerOptions, retryAttempts: 0 });
    const result = results[0];
    if (result?.status === "translated") {
      return { ok: true, name: "Provider responds to a probe request", detail: `Model: ${result.model}.` };
    }
    return {
      ok: false,
      name: "Provider responds to a probe request",
      detail: result?.issues?.[0]?.message ?? "the provider returned no translated result"
    };
  } catch (error: unknown) {
    return { ok: false, name: "Provider responds to a probe request", detail: errorMessage(error) };
  }
}
