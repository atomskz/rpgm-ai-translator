// Scripts that indicate human-readable prose worth translating. Besides Latin
// and Cyrillic this covers Japanese kana, CJK unified ideographs, Korean Hangul,
// and fullwidth Latin so that source games written only in those scripts (the
// common RPG Maker case) are not discarded as non-translatable runtime tokens.
const TRANSLATABLE_LETTER_PATTERN = /[A-Za-zА-Яа-яЁёぁ-ゟァ-ヿ一-鿿가-힣Ａ-Ｚａ-ｚ]/;

export function containsTranslatableLetter(value: string): boolean {
  return TRANSLATABLE_LETTER_PATTERN.test(value);
}
