import type { TranslationResult, TranslationUnit } from "./translation.js";

export type ValidationIssue = {
  id?: string;
  severity: "info" | "warning" | "error";
  code:
    | "INVALID_JSON"
    | "ID_MISMATCH"
    | "UNKNOWN_TRANSLATION_ID"
    | "MISSING_TRANSLATION"
    | "MISSING_PLACEHOLDER"
    | "EXTRA_PLACEHOLDER"
    | "DUPLICATE_PLACEHOLDER"
    | "CONTROL_CODE_CHANGED"
    | "NUMBER_CHANGED"
    | "VARIABLE_CHANGED"
    | "MAX_LENGTH_EXCEEDED"
    | "MAX_LINES_EXCEEDED"
    | "EMPTY_TRANSLATION"
    | "UNCHANGED_TRANSLATION"
    | "GLOSSARY_VIOLATION"
    | "TECHNICAL_TOKEN_CHANGED"
    | "PROVIDER_AUTH_ERROR"
    | "PROVIDER_BILLING_ERROR"
    | "PROVIDER_RATE_LIMIT"
    | "PROVIDER_TIMEOUT"
    | "PROVIDER_NETWORK_ERROR"
    | "PROVIDER_SERVER_ERROR"
    | "PROVIDER_REQUEST_ERROR"
    | "PROVIDER_RESPONSE_ERROR"
    | "PROVIDER_RESPONSE_SCHEMA_ERROR";
  message: string;
};

export interface Validator {
  validate(unit: TranslationUnit, result: TranslationResult): ValidationIssue[];
}
