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

// One-line reminder printed by the commands that produce a translated game
// (run, apply). It goes to stderr so a piped stdout payload is unaffected, and
// mirrors the README's Safety note so the obligation is visible at the point of
// use, not only buried in the docs.
const OWNERSHIP_NOTICE =
  "Notice: translate only games you own or have the right to modify, and do not redistribute copyrighted assets. See the README's Safety section.";

export function printOwnershipNotice(stderr: (text: string) => void): void {
  stderr(`${OWNERSHIP_NOTICE}\n`);
}
