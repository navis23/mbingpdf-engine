/**
 * Contextual lookups: GSUB types 5 and 6, GPOS types 7 and 8. Both tables use the same
 * formats; only what the nested lookups do differs.
 */
import type { BinaryReader } from "../reader.ts";
import type { ShapingBuffer } from "./buffer.ts";
import { classOf, coverageIndex, type Lookup } from "./common.ts";

/** Applies lookup `lookupIndex` once at glyph `position`. Returns whether it did anything. */
export type NestedApply = (lookupIndex: number, position: number) => boolean;

type Matcher = (glyph: number, value: number) => boolean;

/**
 * Matches a backtrack, input and lookahead sequence around `start`, whose own glyph is already
 * known to match. Each sequence is read as `count` 16-bit values from the given offsets.
 * Returns the positions of the input glyphs, or undefined.
 */
function match(
  buffer: ShapingBuffer,
  lookup: Lookup,
  r: BinaryReader,
  start: number,
  backtrack: { at: number; count: number; test: Matcher },
  input: { at: number; count: number; test: Matcher },
  lookahead: { at: number; count: number; test: Matcher },
): number[] | undefined {
  const glyphs = buffer.glyphs;
  const positions = [start];
  let index = start;
  for (let i = 0; i < input.count; i++) {
    index = buffer.next(index, lookup);
    if (index < 0 || !input.test(glyphs[index]?.id as number, r.u16At(input.at + i * 2))) {
      return undefined;
    }
    positions.push(index);
  }
  let before = start;
  for (let i = 0; i < backtrack.count; i++) {
    before = buffer.previous(before, lookup);
    if (
      before < 0 ||
      !backtrack.test(glyphs[before]?.id as number, r.u16At(backtrack.at + i * 2))
    ) {
      return undefined;
    }
  }
  for (let i = 0; i < lookahead.count; i++) {
    index = buffer.next(index, lookup);
    if (index < 0 || !lookahead.test(glyphs[index]?.id as number, r.u16At(lookahead.at + i * 2))) {
      return undefined;
    }
  }
  return positions;
}

/** Runs the nested lookups of a matched rule and returns the index to continue from. */
function applyRecords(
  buffer: ShapingBuffer,
  r: BinaryReader,
  positions: number[],
  recordsAt: number,
  recordCount: number,
  apply: NestedApply,
): number {
  for (let i = 0; i < recordCount; i++) {
    const sequenceIndex = r.u16At(recordsAt + i * 4);
    const lookupIndex = r.u16At(recordsAt + i * 4 + 2);
    const position = positions[sequenceIndex];
    if (position === undefined) continue;
    const before = buffer.glyphs.length;
    apply(lookupIndex, position);
    // A nested substitution may have added or removed glyphs; later positions move with it.
    const delta = buffer.glyphs.length - before;
    if (delta !== 0) {
      for (let j = sequenceIndex + 1; j < positions.length; j++) {
        positions[j] = Math.max((positions[j] as number) + delta, position);
      }
    }
  }
  return Math.min((positions.at(-1) as number) + 1, buffer.glyphs.length);
}

const NONE = { at: 0, count: 0, test: (): boolean => false };

/**
 * Applies one context or chained-context subtable at `index`. Returns the index to continue
 * from, or -1 when the subtable does not match there.
 */
export function applyContext(
  buffer: ShapingBuffer,
  lookup: Lookup,
  r: BinaryReader,
  subtable: number,
  chained: boolean,
  index: number,
  apply: NestedApply,
): number {
  const glyph = (buffer.glyphs[index] as { id: number }).id;
  const format = r.u16At(subtable);

  if (format === 3) {
    // One rule, each position described by a coverage table.
    const covered: Matcher = (id, offset) => coverageIndex(r, subtable + offset, id) >= 0;
    let at = subtable + 2;
    let backtrack = NONE as { at: number; count: number; test: Matcher };
    if (chained) {
      backtrack = { at: at + 2, count: r.u16At(at), test: covered };
      at += 2 + backtrack.count * 2;
    }
    const inputCount = r.u16At(at);
    let recordCount = 0;
    if (!chained) {
      recordCount = r.u16At(at + 2);
      at += 4;
    } else {
      at += 2;
    }
    if (inputCount === 0 || coverageIndex(r, subtable + r.u16At(at), glyph) < 0) return -1;
    const input = { at: at + 2, count: inputCount - 1, test: covered };
    at += inputCount * 2;
    let lookahead = NONE as { at: number; count: number; test: Matcher };
    if (chained) {
      lookahead = { at: at + 2, count: r.u16At(at), test: covered };
      at += 2 + lookahead.count * 2;
      recordCount = r.u16At(at);
      at += 2;
    }
    const positions = match(buffer, lookup, r, index, backtrack, input, lookahead);
    return positions ? applyRecords(buffer, r, positions, at, recordCount, apply) : -1;
  }

  const coverage = coverageIndex(r, subtable + r.u16At(subtable + 2), glyph);
  if (coverage < 0) return -1;

  let setIndex: number;
  let setsAt: number;
  let tests: [Matcher, Matcher, Matcher];
  if (format === 1) {
    const same: Matcher = (id, value) => id === value;
    tests = [same, same, same];
    setIndex = coverage;
    setsAt = subtable + 4;
  } else if (format === 2) {
    const byClass =
      (classDef: number): Matcher =>
      (id, value) =>
        classOf(r, subtable + classDef, id) === value;
    if (chained) {
      const inputClasses = r.u16At(subtable + 6);
      tests = [
        byClass(r.u16At(subtable + 4)),
        byClass(inputClasses),
        byClass(r.u16At(subtable + 8)),
      ];
      setIndex = classOf(r, subtable + inputClasses, glyph);
      setsAt = subtable + 10;
    } else {
      const classes = r.u16At(subtable + 4);
      tests = [byClass(classes), byClass(classes), byClass(classes)];
      setIndex = classOf(r, subtable + classes, glyph);
      setsAt = subtable + 6;
    }
  } else {
    return -1;
  }
  if (setIndex >= r.u16At(setsAt)) return -1;
  const setOffset = r.u16At(setsAt + 2 + setIndex * 2);
  if (setOffset === 0) return -1;
  const set = subtable + setOffset;
  const ruleCount = r.u16At(set);
  for (let i = 0; i < ruleCount; i++) {
    let at = set + r.u16At(set + 2 + i * 2);
    let backtrack = NONE as { at: number; count: number; test: Matcher };
    let lookahead = NONE as { at: number; count: number; test: Matcher };
    let recordCount: number;
    let input: { at: number; count: number; test: Matcher };
    if (chained) {
      backtrack = { at: at + 2, count: r.u16At(at), test: tests[0] };
      at += 2 + backtrack.count * 2;
      const inputCount = r.u16At(at);
      input = { at: at + 2, count: inputCount - 1, test: tests[1] };
      at += 2 + (inputCount - 1) * 2;
      lookahead = { at: at + 2, count: r.u16At(at), test: tests[2] };
      at += 2 + lookahead.count * 2;
      recordCount = r.u16At(at);
      at += 2;
    } else {
      const inputCount = r.u16At(at);
      recordCount = r.u16At(at + 2);
      input = { at: at + 4, count: inputCount - 1, test: tests[1] };
      at += 4 + (inputCount - 1) * 2;
    }
    const positions = match(buffer, lookup, r, index, backtrack, input, lookahead);
    if (positions) return applyRecords(buffer, r, positions, at, recordCount, apply);
  }
  return -1;
}
