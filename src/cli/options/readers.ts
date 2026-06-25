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

import type { ValidationIssue } from "../../core/types/public-api.js";
import { isValidationIssueCode } from "../../core/validators/public-api.js";
import { UsageError } from "./usage-error.js";

export function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export function readPositiveIntegerOption(args: string[], name: string): number | undefined {
  const value = readOption(args, name);
  if (value == null) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new UsageError(`${name} must be a positive integer`);
  }
  return parsed;
}

export function readNonNegativeIntegerOption(args: string[], name: string): number | undefined {
  const value = readOption(args, name);
  if (value == null) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new UsageError(`${name} must be a non-negative integer`);
  }
  return parsed;
}

export function readNumberOption(
  args: string[],
  name: string,
  options: { min?: number; max?: number } = {}
): number | undefined {
  const value = readOption(args, name);
  if (value == null) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new UsageError(`${name} must be a number`);
  }
  if (options.min != null && parsed < options.min) {
    throw new UsageError(`${name} must be greater than or equal to ${options.min}`);
  }
  if (options.max != null && parsed > options.max) {
    throw new UsageError(`${name} must be less than or equal to ${options.max}`);
  }
  return parsed;
}

export function readIssueCodesOption(args: string[], name: string): ValidationIssue["code"][] | undefined {
  const value = readOption(args, name);
  if (value == null) {
    return undefined;
  }

  const codes = value
    .split(",")
    .map((code) => code.trim())
    .filter((code) => code.length > 0);
  for (const code of codes) {
    if (!isValidationIssueCode(code)) {
      throw new UsageError(`${name} contains unknown validation issue code '${code}'`);
    }
  }
  return codes as ValidationIssue["code"][];
}

export function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

export function requireArg(value: string | undefined, label: string): string {
  if (!value) {
    throw new UsageError(`Missing ${label}`);
  }
  return value;
}

export function requireOption(args: string[], name: string): string {
  const value = readOption(args, name);
  if (!value) {
    throw new UsageError(`Missing required option ${name}`);
  }
  return value;
}
