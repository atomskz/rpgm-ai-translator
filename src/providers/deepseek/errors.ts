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

import type { ValidationIssue } from "../../core/types.js";
import type { DeepSeekResponse } from "./types.js";

export class DeepSeekProviderError extends Error {
  readonly issueCode: ValidationIssue["code"];

  constructor(message: string, issueCode: ValidationIssue["code"], options?: ErrorOptions) {
    super(message, options);
    this.name = "DeepSeekProviderError";
    this.issueCode = issueCode;
  }
}

export async function createHttpError(response: DeepSeekResponse): Promise<DeepSeekProviderError> {
  const detail = await readHttpErrorDetail(response);
  const reason = detail ? `: ${detail}` : response.statusText ? `: ${response.statusText}` : "";
  return new DeepSeekProviderError(
    `DeepSeek API error ${response.status}${reason}`,
    issueCodeForHttpStatus(response.status)
  );
}

export function providerIssue(id: string, error: unknown): ValidationIssue {
  const normalized = normalizeProviderError(error);
  return {
    id,
    severity: "error",
    code: normalized.code,
    message: normalized.message
  };
}

async function readHttpErrorDetail(response: DeepSeekResponse): Promise<string | undefined> {
  try {
    const payload = await response.json();
    return extractErrorMessage(payload);
  } catch {
    return undefined;
  }
}

function extractErrorMessage(payload: unknown): string | undefined {
  if (typeof payload === "string") {
    return payload;
  }
  if (typeof payload !== "object" || payload == null || Array.isArray(payload)) {
    return undefined;
  }

  const candidate = payload as { error?: unknown; message?: unknown };
  if (typeof candidate.message === "string") {
    return candidate.message;
  }
  if (typeof candidate.error === "string") {
    return candidate.error;
  }
  if (typeof candidate.error === "object" && candidate.error != null && !Array.isArray(candidate.error)) {
    const error = candidate.error as { message?: unknown; type?: unknown; code?: unknown };
    const parts = [error.message, error.type, error.code].filter((part): part is string => typeof part === "string");
    if (parts.length > 0) {
      return parts.join(" ");
    }
  }
  return undefined;
}

function issueCodeForHttpStatus(status: number): ValidationIssue["code"] {
  if (status === 401) {
    return "PROVIDER_AUTH_ERROR";
  }
  if (status === 402) {
    return "PROVIDER_BILLING_ERROR";
  }
  if (status === 408) {
    return "PROVIDER_TIMEOUT";
  }
  if (status === 429) {
    return "PROVIDER_RATE_LIMIT";
  }
  if (status === 400 || status === 422) {
    return "PROVIDER_REQUEST_ERROR";
  }
  if (status >= 500) {
    return "PROVIDER_SERVER_ERROR";
  }
  return "PROVIDER_RESPONSE_ERROR";
}

// Node/undici socket error codes that mean the request never got a usable
// response and is safe to retry. undici wraps the original socket error as the
// `cause` of a generic "fetch failed" TypeError, so classification walks the
// cause chain by code rather than matching the wrapper message.
const NETWORK_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH"
]);

export function networkErrorCode(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current != null && !seen.has(current)) {
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && (NETWORK_ERROR_CODES.has(code) || code.startsWith("UND_ERR"))) {
      return code;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

// Classify purely by the error code walked from the cause chain, never by the
// message text: a `fetch failed` TypeError from undici always carries a `cause`
// with the real code (ECONNRESET, ENOTFOUND, UND_ERR_*, ...), so matching the
// message string was a brittle duplicate that contradicted the code-based path.
export function isNetworkError(error: unknown): boolean {
  return networkErrorCode(error) !== undefined;
}

function normalizeProviderError(error: unknown): { code: ValidationIssue["code"]; message: string } {
  if (error instanceof DeepSeekProviderError) {
    return { code: error.issueCode, message: error.message };
  }
  if (isTimeoutError(error)) {
    return { code: "PROVIDER_TIMEOUT", message: "DeepSeek API request timed out" };
  }
  if (isNetworkError(error)) {
    const code = networkErrorCode(error);
    const message = error instanceof Error ? error.message : String(error);
    return { code: "PROVIDER_NETWORK_ERROR", message: code ? `${message} (${code})` : message };
  }
  if (error instanceof Error) {
    return { code: "PROVIDER_RESPONSE_ERROR", message: error.message };
  }
  return { code: "PROVIDER_RESPONSE_ERROR", message: String(error) };
}
