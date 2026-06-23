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
