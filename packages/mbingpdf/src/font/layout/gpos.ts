/** Glyph positioning (the GPOS table). */

import { roundDelta } from "../variations.ts";
import type { BufferGlyph, ShapingBuffer } from "./buffer.ts";
import { classOf, coverageIndex, IGNORE_MARKS, type LayoutTable, type Lookup } from "./common.ts";
import { applyContext } from "./context.ts";

/** Size in bytes of a ValueRecord with the given format: two per bit set. */
function valueSize(format: number): number {
  let size = 0;
  for (let bits = format; bits !== 0; bits >>= 1) size += (bits & 1) * 2;
  return size;
}

/**
 * Adds a ValueRecord to a glyph. `base` is the table that the record's device offsets are
 * measured from.
 */
function applyValue(
  table: LayoutTable,
  base: number,
  at: number,
  format: number,
  glyph: BufferGlyph,
): void {
  const r = table.r;
  let offset = at;
  let xPlacement = 0;
  let yPlacement = 0;
  let xAdvance = 0;
  let yAdvance = 0;
  if (format & 0x0001) {
    xPlacement = r.i16At(offset);
    offset += 2;
  }
  if (format & 0x0002) {
    yPlacement = r.i16At(offset);
    offset += 2;
  }
  if (format & 0x0004) {
    xAdvance = r.i16At(offset);
    offset += 2;
  }
  if (format & 0x0008) {
    yAdvance = r.i16At(offset);
    offset += 2;
  }
  if (format & 0x0010) {
    xPlacement += table.deviceDelta(base, r.u16At(offset));
    offset += 2;
  }
  if (format & 0x0020) {
    yPlacement += table.deviceDelta(base, r.u16At(offset));
    offset += 2;
  }
  if (format & 0x0040) {
    xAdvance += table.deviceDelta(base, r.u16At(offset));
    offset += 2;
  }
  if (format & 0x0080) yAdvance += table.deviceDelta(base, r.u16At(offset));
  glyph.xOffset += roundDelta(xPlacement);
  glyph.yOffset += roundDelta(yPlacement);
  glyph.xAdvance += roundDelta(xAdvance);
  glyph.yAdvance += roundDelta(yAdvance);
}

/** Reads an Anchor table; undefined for a null offset. */
function anchor(table: LayoutTable, base: number, offset: number): [number, number] | undefined {
  if (offset === 0) return undefined;
  const r = table.r;
  const at = base + offset;
  let x = r.i16At(at + 2);
  let y = r.i16At(at + 4);
  if (r.u16At(at) === 3) {
    x += table.deviceDelta(at, r.u16At(at + 6));
    y += table.deviceDelta(at, r.u16At(at + 8));
  }
  return [x, y];
}

/** Places `mark` so that its anchor sits on the anchor of the glyph at `target`. */
function attach(
  buffer: ShapingBuffer,
  markIndex: number,
  target: number,
  markAnchor: [number, number],
  targetAnchor: [number, number],
): void {
  const mark = buffer.glyphs[markIndex] as BufferGlyph;
  // Anchors keep their fractional variation deltas; only the difference is rounded.
  mark.xOffset = roundDelta(targetAnchor[0] - markAnchor[0]);
  mark.yOffset = roundDelta(targetAnchor[1] - markAnchor[1]);
  mark.attachedTo = target;
}

/** Looks up a mark in a MarkArray: its class and anchor. */
function markRecord(
  table: LayoutTable,
  markArray: number,
  index: number,
): { markClass: number; anchor: [number, number] } | undefined {
  const r = table.r;
  if (index >= r.u16At(markArray)) return undefined;
  const record = markArray + 2 + index * 4;
  const point = anchor(table, markArray, r.u16At(record + 2));
  return point ? { markClass: r.u16At(record), anchor: point } : undefined;
}

function applyAt(table: LayoutTable, buffer: ShapingBuffer, lookup: Lookup, index: number): number {
  const r = table.r;
  const glyphs = buffer.glyphs;
  const glyph = glyphs[index] as BufferGlyph;
  for (const subtable of lookup.subtables) {
    const format = r.u16At(subtable);
    switch (lookup.type) {
      case 1: {
        // Single adjustment.
        const coverage = coverageIndex(r, subtable + r.u16At(subtable + 2), glyph.id);
        if (coverage < 0) break;
        const valueFormat = r.u16At(subtable + 4);
        if (format === 1) applyValue(table, subtable, subtable + 6, valueFormat, glyph);
        else if (coverage < r.u16At(subtable + 6)) {
          applyValue(
            table,
            subtable,
            subtable + 8 + coverage * valueSize(valueFormat),
            valueFormat,
            glyph,
          );
        } else break;
        return index + 1;
      }
      case 2: {
        // Pair adjustment: kerning.
        const coverage = coverageIndex(r, subtable + r.u16At(subtable + 2), glyph.id);
        if (coverage < 0) break;
        const second = buffer.next(index, lookup);
        if (second < 0) break;
        const other = glyphs[second] as BufferGlyph;
        const format1 = r.u16At(subtable + 4);
        const format2 = r.u16At(subtable + 6);
        const size1 = valueSize(format1);
        const size2 = valueSize(format2);
        let values = -1;
        // Device offsets in a pair set are measured from the set, otherwise from the subtable.
        let valueBase = subtable;
        if (format === 1) {
          if (coverage >= r.u16At(subtable + 8)) break;
          const set = subtable + r.u16At(subtable + 10 + coverage * 2);
          const recordSize = 2 + size1 + size2;
          let low = 0;
          let high = r.u16At(set) - 1;
          while (low <= high) {
            const mid = (low + high) >> 1;
            const candidate = r.u16At(set + 2 + mid * recordSize);
            if (candidate === other.id) {
              values = set + 2 + mid * recordSize + 2;
              valueBase = set;
              break;
            }
            if (candidate < other.id) low = mid + 1;
            else high = mid - 1;
          }
        } else if (format === 2) {
          const class1 = classOf(r, subtable + r.u16At(subtable + 8), glyph.id);
          const class2 = classOf(r, subtable + r.u16At(subtable + 10), other.id);
          const count1 = r.u16At(subtable + 12);
          const count2 = r.u16At(subtable + 14);
          if (class1 < count1 && class2 < count2) {
            values = subtable + 16 + (class1 * count2 + class2) * (size1 + size2);
          }
        }
        if (values < 0) break;
        applyValue(table, valueBase, values, format1, glyph);
        applyValue(table, valueBase, values + size1, format2, other);
        // The second glyph can start the next pair unless this pair adjusted it.
        return format2 !== 0 ? second + 1 : second;
      }
      case 4: {
        // Mark to base.
        const markIndex = coverageIndex(r, subtable + r.u16At(subtable + 2), glyph.id);
        if (markIndex < 0) break;
        let base = index - 1;
        while (base >= 0 && buffer.isMark(base)) base--;
        if (base < 0) break;
        const baseIndex = coverageIndex(
          r,
          subtable + r.u16At(subtable + 4),
          glyphs[base]?.id as number,
        );
        if (baseIndex < 0) break;
        const classCount = r.u16At(subtable + 6);
        const mark = markRecord(table, subtable + r.u16At(subtable + 8), markIndex);
        const baseArray = subtable + r.u16At(subtable + 10);
        if (!mark || mark.markClass >= classCount || baseIndex >= r.u16At(baseArray)) break;
        const point = anchor(
          table,
          baseArray,
          r.u16At(baseArray + 2 + (baseIndex * classCount + mark.markClass) * 2),
        );
        if (!point) break;
        attach(buffer, index, base, mark.anchor, point);
        return index + 1;
      }
      case 5: {
        // Mark to ligature: the anchor depends on which component the mark belongs to.
        const markIndex = coverageIndex(r, subtable + r.u16At(subtable + 2), glyph.id);
        if (markIndex < 0) break;
        let base = index - 1;
        while (base >= 0 && buffer.isMark(base)) base--;
        if (base < 0) break;
        const ligature = glyphs[base] as BufferGlyph;
        const ligatureIndex = coverageIndex(r, subtable + r.u16At(subtable + 4), ligature.id);
        if (ligatureIndex < 0) break;
        const classCount = r.u16At(subtable + 6);
        const mark = markRecord(table, subtable + r.u16At(subtable + 8), markIndex);
        const ligatureArray = subtable + r.u16At(subtable + 10);
        if (!mark || mark.markClass >= classCount || ligatureIndex >= r.u16At(ligatureArray)) break;
        const attachTable = ligatureArray + r.u16At(ligatureArray + 2 + ligatureIndex * 2);
        const componentCount = r.u16At(attachTable);
        if (componentCount === 0) break;
        const belongs =
          ligature.ligatureId !== 0 &&
          ligature.ligatureId === glyph.ligatureId &&
          glyph.ligatureComponent > 0;
        const component = belongs
          ? Math.min(glyph.ligatureComponent, componentCount) - 1
          : componentCount - 1;
        const point = anchor(
          table,
          attachTable,
          r.u16At(attachTable + 2 + (component * classCount + mark.markClass) * 2),
        );
        if (!point) break;
        attach(buffer, index, base, mark.anchor, point);
        return index + 1;
      }
      case 6: {
        // Mark to mark: stacking accents.
        const markIndex = coverageIndex(r, subtable + r.u16At(subtable + 2), glyph.id);
        if (markIndex < 0) break;
        // Find the previous mark, honouring the lookup's own filtering but not IgnoreMarks.
        const filter: Lookup = { ...lookup, flag: lookup.flag & ~IGNORE_MARKS };
        const previous = buffer.previous(index, filter);
        if (previous < 0 || !buffer.isMark(previous)) break;
        const target = glyphs[previous] as BufferGlyph;
        // Two marks stack only when they sit on the same base or ligature component.
        const sameComponent =
          target.ligatureId === glyph.ligatureId
            ? target.ligatureComponent === glyph.ligatureComponent
            : (target.ligatureId !== 0 && target.ligatureComponent === 0) ||
              (glyph.ligatureId !== 0 && glyph.ligatureComponent === 0);
        if (!sameComponent) break;
        const mark2Index = coverageIndex(r, subtable + r.u16At(subtable + 4), target.id);
        if (mark2Index < 0) break;
        const classCount = r.u16At(subtable + 6);
        const mark = markRecord(table, subtable + r.u16At(subtable + 8), markIndex);
        const mark2Array = subtable + r.u16At(subtable + 10);
        if (!mark || mark.markClass >= classCount || mark2Index >= r.u16At(mark2Array)) break;
        const point = anchor(
          table,
          mark2Array,
          r.u16At(mark2Array + 2 + (mark2Index * classCount + mark.markClass) * 2),
        );
        if (!point) break;
        attach(buffer, index, previous, mark.anchor, point);
        return index + 1;
      }
      case 7:
      case 8: {
        const next = applyContext(
          buffer,
          lookup,
          r,
          subtable,
          lookup.type === 8,
          index,
          (nested, at) => {
            const nestedLookup = table.lookup(nested);
            return nestedLookup ? applyAt(table, buffer, nestedLookup, at) >= 0 : false;
          },
        );
        if (next >= 0) return next;
        break;
      }
      default:
        // Type 3 (cursive attachment) is for joined scripts, which this shaper does not cover.
        break;
    }
  }
  return -1;
}

/** Runs one GPOS lookup over the whole buffer. */
export function applyGposLookup(
  table: LayoutTable,
  buffer: ShapingBuffer,
  lookupIndex: number,
): void {
  const lookup = table.lookup(lookupIndex);
  if (!lookup) return;
  let index = 0;
  while (index < buffer.glyphs.length) {
    if (buffer.skips(index, lookup)) {
      index++;
      continue;
    }
    const next = applyAt(table, buffer, lookup, index);
    index = next > index ? next : index + 1;
  }
}

/**
 * Turns "attached to glyph N" into final offsets. A mark's offset is measured from its own pen
 * position, so the advances between the glyph it is attached to and the mark are taken off.
 */
export function resolveAttachments(buffer: ShapingBuffer): void {
  const glyphs = buffer.glyphs;
  for (let i = 0; i < glyphs.length; i++) {
    const glyph = glyphs[i] as BufferGlyph;
    const target = glyph.attachedTo;
    if (target < 0) continue;
    const base = glyphs[target] as BufferGlyph;
    glyph.xOffset += base.xOffset;
    glyph.yOffset += base.yOffset;
    for (let j = target; j < i; j++) {
      glyph.xOffset -= (glyphs[j] as BufferGlyph).xAdvance;
      glyph.yOffset -= (glyphs[j] as BufferGlyph).yAdvance;
    }
  }
}
