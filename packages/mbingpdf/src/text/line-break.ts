/**
 * The Unicode Line Breaking Algorithm (UAX #14), default rules without tailoring.
 *
 * Implemented here rather than taken from `Intl.Segmenter`, whose results depend on the
 * runtime's ICU version and would make page breaks differ between browsers and servers.
 */
import { EAST_ASIAN_DATA, LINE_BREAK_CLASSES, LINE_BREAK_DATA } from "./unicode-data.ts";
import { UnicodeTable } from "./unicode-table.ts";

type StoredClass = (typeof LINE_BREAK_CLASSES)[number];
/** The classes the rules work with: the stored ones minus the two pictograph variants. */
type LineBreakClass = Exclude<StoredClass, "XP_AL" | "XP_ID">;

/** A place where a line may or must end. */
export interface BreakOpportunity {
  /** UTF-16 offset in the text at which the next line would start. */
  readonly offset: number;
  /** True after a line feed or other hard break: the line must end here. */
  readonly mandatory: boolean;
}

let classTable: UnicodeTable | undefined;
let eastAsianTable: UnicodeTable | undefined;

const is = (value: LineBreakClass, ...classes: LineBreakClass[]): boolean =>
  classes.includes(value);

/**
 * Finds every position where `text` may be broken into lines. The end of the text is always
 * the last, mandatory, entry (unless the text is empty).
 */
export function lineBreaks(text: string): BreakOpportunity[] {
  classTable ??= new UnicodeTable(LINE_BREAK_DATA);
  eastAsianTable ??= new UnicodeTable(EAST_ASIAN_DATA);

  // One entry per code point.
  const offsets: number[] = [];
  const raw: LineBreakClass[] = [];
  const eastAsian: boolean[] = [];
  const dottedCircle: boolean[] = [];
  /** Unassigned code points reserved for future pictographs. */
  const futureEmoji: boolean[] = [];
  for (let i = 0; i < text.length; ) {
    const codePoint = text.codePointAt(i) as number;
    offsets.push(i);
    const stored = LINE_BREAK_CLASSES[classTable.get(codePoint)] as StoredClass;
    futureEmoji.push(stored === "XP_AL" || stored === "XP_ID");
    raw.push(stored === "XP_AL" ? "AL" : stored === "XP_ID" ? "ID" : stored);
    eastAsian.push(eastAsianTable.get(codePoint) === 1);
    dottedCircle.push(codePoint === 0x25cc);
    i += codePoint > 0xffff ? 2 : 1;
  }
  const count = raw.length;
  const result: BreakOpportunity[] = [];
  if (count === 0) return result;

  // LB9: a combining mark or joiner takes on the class of the character it follows.
  // LB10: one with nothing to attach to behaves like a letter.
  // `cls` is the class to use in the rules; `base` is the index of the character that a
  // run of attached marks belongs to.
  const cls: LineBreakClass[] = [];
  const base: number[] = [];
  for (let i = 0; i < count; i++) {
    const value = raw[i] as LineBreakClass;
    if (value === "CM" || value === "ZWJ") {
      const previous = i > 0 ? (cls[i - 1] as LineBreakClass) : undefined;
      if (previous !== undefined && !is(previous, "BK", "CR", "LF", "NL", "SP", "ZW")) {
        cls.push(previous);
        base.push(base[i - 1] as number);
        continue;
      }
      cls.push("AL");
      base.push(i);
      continue;
    }
    cls.push(value);
    base.push(i);
  }

  /** Class of the character before the one whose base is at `index`; undefined at the start. */
  const before = (index: number): number => (base[index] as number) - 1;
  /** Index of the last character before `index` that is not a space, or -1. */
  const skipSpaces = (index: number): number => {
    let i = index;
    while (i >= 0 && cls[i] === "SP") i--;
    return i;
  };
  const quote = (value: LineBreakClass | undefined): boolean =>
    value === "QU" || value === "QU_Pi" || value === "QU_Pf";

  /** Whether a break is allowed between code points `i - 1` and `i`. */
  const allowed = (i: number): boolean => {
    const previousRaw = raw[i - 1] as LineBreakClass;
    const p = cls[i - 1] as LineBreakClass;
    const n = cls[i] as LineBreakClass;
    const nextRaw = raw[i] as LineBreakClass;

    // LB6: not before a hard break. LB7: not before a space or zero-width space.
    if (is(nextRaw, "BK", "CR", "LF", "NL", "SP", "ZW")) return false;
    // LB8: break after a zero-width space, even with spaces in between.
    const beforeSpaces = skipSpaces(i - 1);
    if (beforeSpaces >= 0 && raw[beforeSpaces] === "ZW") return true;
    // LB8a: not after a zero-width joiner.
    if (previousRaw === "ZWJ") return false;
    // LB9: not inside a character-plus-marks sequence.
    if ((nextRaw === "CM" || nextRaw === "ZWJ") && base[i] !== i) return false;

    // LB11: not around a word joiner.
    if (n === "WJ" || p === "WJ") return false;
    // LB12: not after a non-breaking space.
    if (p === "GL") return false;
    // LB12a: not before one, except after a space or hyphen.
    if (n === "GL" && !is(p, "SP", "BA", "HY", "HH")) return false;
    // LB13: not before closing punctuation, "!" or "/".
    if (is(n, "CL", "CP", "EX", "SY")) return false;

    const lastSolid = beforeSpaces >= 0 ? (cls[beforeSpaces] as LineBreakClass) : undefined;
    // LB14: not after an opening bracket, even after spaces.
    if (lastSolid === "OP") return false;
    // LB15a: not after an initial quotation mark that opens a quotation.
    if (lastSolid === "QU_Pi") {
      const lead = before(beforeSpaces);
      const leadClass = lead >= 0 ? (cls[lead] as LineBreakClass) : undefined;
      if (
        leadClass === undefined ||
        is(leadClass, "BK", "CR", "LF", "NL", "OP", "GL", "SP", "ZW") ||
        quote(leadClass)
      ) {
        return false;
      }
    }
    // LB15b: not before a final quotation mark that closes one.
    if (n === "QU_Pf") {
      let after = i + 1;
      while (after < count && base[after] === base[i]) after++;
      const follow = after < count ? (cls[after] as LineBreakClass) : undefined;
      if (
        follow === undefined ||
        is(follow, "SP", "GL", "WJ", "CL", "CP", "EX", "IS", "SY", "BK", "CR", "LF", "NL", "ZW") ||
        quote(follow)
      ) {
        return false;
      }
    }
    // LB15c: break before a decimal mark that follows a space ("a .5").
    if (p === "SP" && n === "IS") {
      let after = i + 1;
      while (after < count && base[after] === base[i]) after++;
      if (after < count && cls[after] === "NU") return true;
    }
    // LB15d: otherwise not before a full stop or comma.
    if (n === "IS") return false;
    // LB16: not between closing punctuation and a non-starter, even with spaces.
    if (n === "NS" && lastSolid !== undefined && is(lastSolid, "CL", "CP")) return false;
    // LB17: not inside "— —".
    if (n === "B2" && lastSolid === "B2") return false;
    // LB18: break after spaces.
    if (p === "SP") return true;

    // LB19: not around quotation marks that are not clearly opening or closing…
    if (n === "QU" || n === "QU_Pf") return false;
    if (p === "QU" || p === "QU_Pi") return false;
    // LB19a: …and for the others, only next to East Asian characters.
    if (quote(n)) {
      if (!eastAsian[base[i - 1] as number]) return false;
      let after = i + 1;
      while (after < count && base[after] === base[i]) after++;
      if (after >= count || !eastAsian[after]) return false;
    }
    if (quote(p)) {
      if (!eastAsian[i]) return false;
      const lead = before(i - 1);
      if (lead < 0 || !eastAsian[base[lead] as number]) return false;
    }

    // LB20: break around an inline object.
    if (n === "CB" || p === "CB") return true;
    // LB20a: not after a hyphen that starts a word ("-able").
    if (is(p, "HY", "HH") && is(n, "AL", "HL")) {
      const lead = before(i - 1);
      const leadClass = lead >= 0 ? (cls[lead] as LineBreakClass) : undefined;
      if (
        leadClass === undefined ||
        is(leadClass, "BK", "CR", "LF", "NL", "SP", "ZW", "CB", "GL")
      ) {
        return false;
      }
    }
    // LB21: not before hyphens and small kana; not after an acute-accent-like "break before".
    if (is(n, "BA", "HH", "HY", "NS") || p === "BB") return false;
    // LB21a: not after a hyphen that follows a Hebrew letter.
    if (is(p, "HY", "HH") && n !== "HL") {
      const lead = before(i - 1);
      if (lead >= 0 && cls[lead] === "HL") return false;
    }
    // LB21b: not between a solidus and a Hebrew letter.
    if (p === "SY" && n === "HL") return false;
    // LB22: not before an ellipsis.
    if (n === "IN") return false;
    // LB23: not between letters and digits.
    if ((is(p, "AL", "HL") && n === "NU") || (p === "NU" && is(n, "AL", "HL"))) return false;
    // LB23a: not between a numeric prefix or postfix and an ideograph or emoji.
    if (p === "PR" && is(n, "ID", "EB", "EM")) return false;
    if (is(p, "ID", "EB", "EM") && n === "PO") return false;
    // LB24: not between a currency or percent sign and a letter.
    if (is(p, "PR", "PO") && is(n, "AL", "HL")) return false;
    if (is(p, "AL", "HL") && is(n, "PR", "PO")) return false;

    // LB25: keep numbers together with their signs, separators and units.
    if (is(n, "PO", "PR", "NU")) {
      // Walk back over an optional closing bracket and any "." "," "/" to find a digit.
      let at = i - 1;
      if (n !== "NU" && is(cls[at] as LineBreakClass, "CL", "CP")) at = before(at);
      while (at >= 0 && is(cls[at] as LineBreakClass, "SY", "IS")) at = before(at);
      if (at >= 0 && cls[at] === "NU") return false;
    }
    if (is(p, "PO", "PR")) {
      if (n === "NU") return false;
      if (n === "OP") {
        let after = i + 1;
        while (after < count && base[after] === base[i]) after++;
        if (after < count && cls[after] === "IS") {
          const start = after;
          after++;
          while (after < count && base[after] === base[start]) after++;
        }
        if (after < count && cls[after] === "NU") return false;
      }
    }
    if (is(p, "HY", "IS") && n === "NU") return false;

    // LB26: keep Korean syllable blocks together.
    if (p === "JL" && is(n, "JL", "JV", "H2", "H3")) return false;
    if (is(p, "JV", "H2") && is(n, "JV", "JT")) return false;
    if (is(p, "JT", "H3") && n === "JT") return false;
    // LB27: and treat them like ideographs next to prefixes and postfixes.
    if (is(p, "JL", "JV", "JT", "H2", "H3") && n === "PO") return false;
    if (p === "PR" && is(n, "JL", "JV", "JT", "H2", "H3")) return false;
    // LB28: not between letters.
    if (is(p, "AL", "HL") && is(n, "AL", "HL")) return false;

    // LB28a: keep the consonant clusters of Brahmic scripts together.
    const aksara = (index: number): boolean =>
      index >= 0 &&
      index < count &&
      (is(cls[index] as LineBreakClass, "AK", "AS") ||
        dottedCircle[base[index] as number] === true);
    if (p === "AP" && aksara(i)) return false;
    if (aksara(i - 1) && is(n, "VF", "VI")) return false;
    if (p === "VI" && (n === "AK" || dottedCircle[i] === true) && aksara(before(i - 1)))
      return false;
    if (aksara(i - 1) && aksara(i)) {
      let after = i + 1;
      while (after < count && base[after] === base[i]) after++;
      if (after < count && cls[after] === "VF") return false;
    }

    // LB29: not between a full stop and a letter ("e.g").
    if (p === "IS" && is(n, "AL", "HL")) return false;
    // LB30: not between letters or digits and brackets, except East Asian brackets.
    if (is(p, "AL", "HL", "NU") && n === "OP" && !eastAsian[i]) return false;
    if (p === "CP" && !eastAsian[base[i - 1] as number] && is(n, "AL", "HL", "NU")) return false;
    // LB30a: flags are pairs of regional indicators; break only between pairs.
    if (p === "RI" && n === "RI") {
      let run = 0;
      for (let at = i - 1; at >= 0 && cls[at] === "RI"; at = before(at)) run++;
      if (run % 2 === 1) return false;
    }
    // LB30b: not between an emoji base and its modifier.
    if ((p === "EB" || futureEmoji[base[i - 1] as number]) && n === "EM") return false;
    // LB31: break everywhere else.
    return true;
  };

  for (let i = 1; i < count; i++) {
    const previous = raw[i - 1] as LineBreakClass;
    // LB4, LB5: a hard break, treating CR LF as one.
    if (
      previous === "BK" ||
      previous === "LF" ||
      previous === "NL" ||
      (previous === "CR" && raw[i] !== "LF")
    ) {
      result.push({ offset: offsets[i] as number, mandatory: true });
    } else if (previous !== "CR" && allowed(i)) {
      result.push({ offset: offsets[i] as number, mandatory: false });
    }
  }
  // LB3: always break at the end.
  result.push({ offset: text.length, mandatory: true });
  return result;
}
