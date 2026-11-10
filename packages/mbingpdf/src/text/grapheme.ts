/**
 * Grapheme clusters: what a reader perceives as one character (UAX #29, extended grapheme
 * clusters). "é" typed as e + combining accent, a flag, or a family emoji are each one.
 *
 * Text must never be split, spaced or truncated inside a cluster.
 */
import { GRAPHEME_CLASSES, GRAPHEME_DATA } from "./unicode-data.ts";
import { UnicodeTable } from "./unicode-table.ts";

type GraphemeClass = (typeof GRAPHEME_CLASSES)[number];

let table: UnicodeTable | undefined;

const isExtend = (value: GraphemeClass): boolean =>
  value === "Extend" || value === "InCB_Extend" || value === "InCB_Linker";

/** UTF-16 offsets at which grapheme clusters end. The last is always `text.length`. */
export function graphemeBreaks(text: string): number[] {
  table ??= new UnicodeTable(GRAPHEME_DATA);
  const breaks: number[] = [];
  if (text.length === 0) return breaks;

  let previous: GraphemeClass | undefined;
  /** Consecutive regional indicators seen so far in the current cluster run. */
  let regionalIndicators = 0;
  /** True while in "pictograph Extend*": a following ZWJ may join another pictograph. */
  let afterPictograph = false;
  /** True once a ZWJ has followed that sequence. */
  let pictographJoiner = false;
  /** Indic conjunct state: 1 after a consonant, 2 once a linker has followed it. */
  let conjunct = 0;

  for (let i = 0; i < text.length; ) {
    const codePoint = text.codePointAt(i) as number;
    const current = GRAPHEME_CLASSES[table.get(codePoint)] as GraphemeClass;
    if (previous !== undefined) {
      let split = true;
      if (previous === "CR" && current === "LF")
        split = false; // GB3
      else if (previous === "Control" || previous === "CR" || previous === "LF")
        split = true; // GB4
      else if (current === "Control" || current === "CR" || current === "LF")
        split = true; // GB5
      else if (
        previous === "L" &&
        (current === "L" || current === "V" || current === "LV" || current === "LVT")
      )
        split = false; // GB6
      else if ((previous === "LV" || previous === "V") && (current === "V" || current === "T"))
        split = false; // GB7
      else if ((previous === "LVT" || previous === "T") && current === "T")
        split = false; // GB8
      else if (isExtend(current) || current === "ZWJ")
        split = false; // GB9
      else if (current === "SpacingMark")
        split = false; // GB9a
      else if (previous === "Prepend")
        split = false; // GB9b
      else if (conjunct === 2 && current === "InCB_Consonant")
        split = false; // GB9c
      else if (pictographJoiner && previous === "ZWJ" && current === "ExtPict")
        split = false; // GB11
      else if (previous === "Regional_Indicator" && current === "Regional_Indicator") {
        split = regionalIndicators % 2 === 0; // GB12, GB13
      }
      if (split) breaks.push(i);
    }

    regionalIndicators = current === "Regional_Indicator" ? regionalIndicators + 1 : 0;
    if (current === "ExtPict") {
      afterPictograph = true;
      pictographJoiner = false;
    } else if (afterPictograph && isExtend(current)) {
      pictographJoiner = false;
    } else if (afterPictograph && current === "ZWJ") {
      afterPictograph = false;
      pictographJoiner = true;
    } else {
      afterPictograph = false;
      pictographJoiner = false;
    }
    if (current === "InCB_Consonant") conjunct = 1;
    else if (conjunct > 0 && current === "InCB_Linker") conjunct = 2;
    else if (!(conjunct > 0 && (current === "InCB_Extend" || current === "ZWJ"))) conjunct = 0;

    previous = current;
    i += codePoint > 0xffff ? 2 : 1;
  }
  breaks.push(text.length);
  return breaks;
}

/** Splits text into grapheme clusters. */
export function graphemes(text: string): string[] {
  const clusters: string[] = [];
  let start = 0;
  for (const end of graphemeBreaks(text)) {
    clusters.push(text.slice(start, end));
    start = end;
  }
  return clusters;
}
