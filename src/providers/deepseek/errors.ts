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

function normalizeProviderError(error: unknown): { code: ValidationIssue["code"]; message: string } {
  if (error instanceof DeepSeekProviderError) {
    return { code: error.issueCode, message: error.message };
  }
  if (error instanceof Error && error.name === "AbortError") {
    return { code: "PROVIDER_TIMEOUT", message: "DeepSeek API request timed out" };
  }
  if (error instanceof Error && error.message.includes("fetch failed")) {
    return { code: "PROVIDER_NETWORK_ERROR", message: error.message };
  }
  if (error instanceof Error) {
    return { code: "PROVIDER_RESPONSE_ERROR", message: error.message };
  }
  return { code: "PROVIDER_RESPONSE_ERROR", message: String(error) };
}
