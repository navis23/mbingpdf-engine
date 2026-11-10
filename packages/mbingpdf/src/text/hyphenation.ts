/**
 * Hyphenation: where a word may be split at the end of a line.
 *
 * A {@link Hyphenator} is a plain function, so applications can supply their own (a
 * dictionary, another language) to the paragraph layout.
 */
import { EN_US_EXCEPTIONS, EN_US_PATTERNS } from "./hyphenation-en-us-data.ts";

/**
 * Returns the offsets inside `word` at which a hyphen may be inserted: `[2, 5]` for
 * "hy-phen-ate". The word is a run of letters; the offsets are in UTF-16 units.
 */
export type Hyphenator = (word: string) => number[];

export interface PatternHyphenatorOptions {
  /** Fewest characters allowed before the first hyphen. Default 2. */
  leftMin?: number;
  /** Fewest characters allowed after the last hyphen. Default 3. */
  rightMin?: number;
  /** Words with their hyphens marked, such as `"as-so-ciate"`, that override the patterns. */
  exceptions?: readonly string[];
}

/**
 * Builds a hyphenator from patterns in Liang's notation, as used by TeX: letters with digits
 * between them, where an odd digit allows a break and an even one forbids it (`"hy3ph"`).
 */
export function createPatternHyphenator(
  patterns: readonly string[],
  options: PatternHyphenatorOptions = {},
): Hyphenator {
  const leftMin = options.leftMin ?? 2;
  const rightMin = options.rightMin ?? 3;
  // Letters of the pattern → the digits around them (one more digit than letters).
  const table = new Map<string, number[]>();
  let longest = 0;
  for (const pattern of patterns) {
    let letters = "";
    const digits: number[] = [0];
    for (const char of pattern) {
      if (char >= "0" && char <= "9") digits[digits.length - 1] = Number(char);
      else {
        letters += char;
        digits.push(0);
      }
    }
    table.set(letters, digits);
    longest = Math.max(longest, letters.length);
  }
  const exceptions = new Map<string, number[]>();
  for (const exception of options.exceptions ?? []) {
    const points: number[] = [];
    let offset = 0;
    for (const part of exception.split("-").slice(0, -1)) {
      offset += part.length;
      points.push(offset);
    }
    exceptions.set(exception.replaceAll("-", ""), points);
  }

  return (word) => {
    const lower = word.toLowerCase();
    // Case mappings that change the length would shift the offsets; leave such words whole.
    if (lower.length !== word.length) return [];
    const known = exceptions.get(lower);
    if (known) return known.filter((point) => point >= leftMin && point <= word.length - rightMin);

    const padded = `.${lower}.`;
    const levels = new Uint8Array(padded.length + 1);
    for (let start = 0; start < padded.length; start++) {
      const limit = Math.min(longest, padded.length - start);
      for (let length = 1; length <= limit; length++) {
        const digits = table.get(padded.slice(start, start + length));
        if (!digits) continue;
        for (let i = 0; i < digits.length; i++) {
          const digit = digits[i] as number;
          if (digit > (levels[start + i] as number)) levels[start + i] = digit;
        }
      }
    }
    const points: number[] = [];
    // levels[i] sits before padded[i], which is word[i - 1].
    for (let offset = leftMin; offset <= word.length - rightMin; offset++) {
      if ((levels[offset + 1] as number) % 2 === 1) points.push(offset);
    }
    return points;
  };
}

let english: Hyphenator | undefined;

/** Hyphenation for English with American spelling, from the TeX patterns. */
export const hyphenateEnglish: Hyphenator = (word) => {
  english ??= createPatternHyphenator(EN_US_PATTERNS.split(" "), {
    exceptions: EN_US_EXCEPTIONS.split(" "),
  });
  return english(word);
};

const VOWELS = "aiueo";
/** Two letters written for one sound; they are never separated. */
const DIGRAPHS = ["ng", "ny", "sy", "kh"];

/**
 * Hyphenation for Indonesian, following the syllable rules of the official spelling guide
 * (EYD, "pemenggalan kata"):
 *
 * - a single consonant between vowels goes with the following vowel: ba-pak, de-ngan;
 * - two consonants between vowels are split: man-di, swas-ta, bang-sa;
 * - of three or more, the first stays and the rest move on: in-stru-men, bang-krut.
 *
 * Two vowels in a row are never split, because whether they form a diphthong (pan-dai) or two
 * syllables (ma-in) cannot be told from the spelling. Prefixes and suffixes are not treated
 * specially, so "mengukur" gives me-ngu-kur rather than meng-u-kur.
 */
export const hyphenateIndonesian: Hyphenator = (word) => {
  const lower = word.toLowerCase();
  if (lower.length !== word.length || !/^[a-z]+$/.test(lower)) return [];
  // Split the word into sound units: vowels, single consonants and digraphs.
  const units: { start: number; vowel: boolean }[] = [];
  for (let i = 0; i < lower.length; ) {
    const digraph = DIGRAPHS.includes(lower.slice(i, i + 2));
    units.push({ start: i, vowel: VOWELS.includes(lower.charAt(i)) });
    i += digraph ? 2 : 1;
  }
  const points: number[] = [];
  for (let i = 0; i < units.length; i++) {
    if (!(units[i] as { vowel: boolean }).vowel) continue;
    // Find the consonants between this vowel and the next one.
    let next = i + 1;
    while (next < units.length && !(units[next] as { vowel: boolean }).vowel) next++;
    if (next >= units.length) break;
    const consonants = next - i - 1;
    if (consonants === 0) continue;
    // One consonant moves to the next syllable; of several, only the first stays behind.
    const split = consonants === 1 ? i + 1 : i + 2;
    const offset = (units[split] as { start: number }).start;
    if (offset >= 2 && offset <= word.length - 2) points.push(offset);
  }
  return points;
};
