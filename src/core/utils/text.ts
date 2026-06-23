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

// Scripts that indicate human-readable prose worth translating. Besides Latin
// and Cyrillic this covers Japanese kana, CJK unified ideographs, Korean Hangul,
// and fullwidth Latin so that source games written only in those scripts (the
// common RPG Maker case) are not discarded as non-translatable runtime tokens.
const TRANSLATABLE_LETTER_PATTERN = /[A-Za-zА-Яа-яЁёぁ-ゟァ-ヿ一-鿿가-힣Ａ-Ｚａ-ｚ]/;

export function containsTranslatableLetter(value: string): boolean {
  return TRANSLATABLE_LETTER_PATTERN.test(value);
}
