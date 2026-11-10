/** Glyph substitution (the GSUB table). */
import { type BufferGlyph, newGlyph, type ShapingBuffer } from "./buffer.ts";
import { coverageIndex, type LayoutTable, type Lookup } from "./common.ts";
import { applyContext } from "./context.ts";

/**
 * Tries the lookup's subtables at `index`. Returns the index to continue from, or -1 when
 * none of them applies there.
 */
function applyAt(
  table: LayoutTable,
  buffer: ShapingBuffer,
  lookup: Lookup,
  index: number,
  value: number,
): number {
  const r = table.r;
  const glyphs = buffer.glyphs;
  const glyph = glyphs[index] as BufferGlyph;
  for (const subtable of lookup.subtables) {
    switch (lookup.type) {
      case 1: {
        // Single: one glyph becomes another.
        const coverage = coverageIndex(r, subtable + r.u16At(subtable + 2), glyph.id);
        if (coverage < 0) break;
        if (r.u16At(subtable) === 1) glyph.id = (glyph.id + r.u16At(subtable + 4)) & 0xffff;
        else if (coverage < r.u16At(subtable + 4)) glyph.id = r.u16At(subtable + 6 + coverage * 2);
        else break;
        return index + 1;
      }
      case 2: {
        // Multiple: one glyph becomes several (or none).
        const coverage = coverageIndex(r, subtable + r.u16At(subtable + 2), glyph.id);
        if (coverage < 0 || coverage >= r.u16At(subtable + 4)) break;
        const sequence = subtable + r.u16At(subtable + 6 + coverage * 2);
        const count = r.u16At(sequence);
        const replacement: BufferGlyph[] = [];
        for (let i = 0; i < count; i++) {
          const part = newGlyph(r.u16At(sequence + 2 + i * 2), glyph.cluster);
          part.ligatureId = glyph.ligatureId;
          part.ligatureComponent = glyph.ligatureComponent;
          replacement.push(part);
        }
        glyphs.splice(index, 1, ...replacement);
        return index + count;
      }
      case 3: {
        // Alternate: the feature value picks one of several alternatives, counting from 1.
        const coverage = coverageIndex(r, subtable + r.u16At(subtable + 2), glyph.id);
        if (coverage < 0 || coverage >= r.u16At(subtable + 4)) break;
        const set = subtable + r.u16At(subtable + 6 + coverage * 2);
        if (value < 1 || value > r.u16At(set)) break;
        glyph.id = r.u16At(set + 2 + (value - 1) * 2);
        return index + 1;
      }
      case 4: {
        // Ligature: several glyphs become one.
        const coverage = coverageIndex(r, subtable + r.u16At(subtable + 2), glyph.id);
        if (coverage < 0 || coverage >= r.u16At(subtable + 4)) break;
        const set = subtable + r.u16At(subtable + 6 + coverage * 2);
        const ligatures = r.u16At(set);
        for (let i = 0; i < ligatures; i++) {
          const ligature = set + r.u16At(set + 2 + i * 2);
          const componentCount = r.u16At(ligature + 2);
          const positions = [index];
          let at = index;
          let matched = true;
          for (let c = 1; c < componentCount; c++) {
            at = buffer.next(at, lookup);
            if (at < 0 || glyphs[at]?.id !== r.u16At(ligature + 4 + (c - 1) * 2)) {
              matched = false;
              break;
            }
            positions.push(at);
          }
          if (!matched) continue;
          formLigature(buffer, positions, r.u16At(ligature));
          return index + 1;
        }
        break;
      }
      case 5:
      case 6: {
        const next = applyContext(
          buffer,
          lookup,
          r,
          subtable,
          lookup.type === 6,
          index,
          (nested, at) => applyNested(table, buffer, nested, at, value),
        );
        if (next >= 0) return next;
        break;
      }
      default:
        // Type 8 (reverse chaining) is used by a handful of Arabic-style fonts only.
        break;
    }
  }
  return -1;
}

/** Replaces the glyphs at `positions` with one ligature glyph, keeping skipped marks. */
function formLigature(buffer: ShapingBuffer, positions: number[], ligature: number): void {
  const glyphs = buffer.glyphs;
  const first = positions[0] as number;
  const last = positions.at(-1) as number;
  const target = glyphs[first] as BufferGlyph;
  const id = buffer.newLigatureId();

  // Everything from the first to the last component becomes one cluster.
  let cluster = target.cluster;
  for (let i = first; i <= last; i++)
    cluster = Math.min(cluster, (glyphs[i] as BufferGlyph).cluster);

  // Marks between components stay, and remember which component they sat on.
  let component = 1;
  let positionIndex = 1;
  const kept: BufferGlyph[] = [];
  for (let i = first + 1; i <= last; i++) {
    if (i === positions[positionIndex]) {
      component++;
      positionIndex++;
      continue;
    }
    const mark = glyphs[i] as BufferGlyph;
    mark.ligatureId = id;
    mark.ligatureComponent = component;
    mark.cluster = cluster;
    kept.push(mark);
  }
  target.id = ligature;
  target.cluster = cluster;
  target.ligatureId = id;
  target.ligatureComponent = 0;
  target.componentCount = positions.length;
  glyphs.splice(first + 1, last - first, ...kept);

  // Marks right after the ligature belong to its last component.
  for (let i = first + 1 + kept.length; i < glyphs.length && buffer.isMark(i); i++) {
    const mark = glyphs[i] as BufferGlyph;
    if (mark.ligatureId !== 0) break;
    mark.ligatureId = id;
    mark.ligatureComponent = positions.length;
  }
}

function applyNested(
  table: LayoutTable,
  buffer: ShapingBuffer,
  lookupIndex: number,
  position: number,
  value: number,
): boolean {
  const lookup = table.lookup(lookupIndex);
  if (!lookup || position >= buffer.glyphs.length) return false;
  return applyAt(table, buffer, lookup, position, value) >= 0;
}

/** Runs one GSUB lookup over the whole buffer. */
export function applyGsubLookup(
  table: LayoutTable,
  buffer: ShapingBuffer,
  lookupIndex: number,
  value: number,
): void {
  const lookup = table.lookup(lookupIndex);
  if (!lookup) return;
  let index = 0;
  while (index < buffer.glyphs.length) {
    if (buffer.skips(index, lookup)) {
      index++;
      continue;
    }
    const next = applyAt(table, buffer, lookup, index, value);
    index = next > index ? next : index + 1;
  }
}
