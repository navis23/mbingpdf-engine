/**
 * OpenType font variations: the axes a variable font offers and the tables that say how
 * metrics change along them (fvar, avar, HVAR, MVAR and the shared ItemVariationStore).
 */
import { BinaryReader } from "./reader.ts";

export interface VariationAxis {
  /** Four-letter tag such as `wght` (weight), `wdth` (width) or `opsz` (optical size). */
  readonly tag: string;
  readonly name: string;
  readonly min: number;
  readonly default: number;
  readonly max: number;
}

export interface NamedInstance {
  /** The style name, such as `Bold`. */
  readonly name: string;
  readonly postScriptName: string | undefined;
  /** Axis tag → value. */
  readonly coordinates: Readonly<Record<string, number>>;
}

/** Rounds halves away from zero, as C's roundf does; variation deltas are rounded this way. */
export function roundDelta(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

const f2dot14 = (r: BinaryReader, offset: number): number => r.i16At(offset) / 16384;

export function parseFvar(
  table: Uint8Array | undefined,
  names: ReadonlyMap<number, string>,
): { axes: VariationAxis[]; instances: NamedInstance[] } {
  if (!table || table.length < 16) return { axes: [], instances: [] };
  const r = new BinaryReader(table);
  const axesAt = r.u16At(4);
  const axisCount = r.u16At(8);
  const axisSize = r.u16At(10);
  const instanceCount = r.u16At(12);
  const instanceSize = r.u16At(14);
  const axes: VariationAxis[] = [];
  for (let i = 0; i < axisCount; i++) {
    const at = axesAt + i * axisSize;
    r.seek(at);
    const tag = r.tag();
    const min = r.fixed();
    const def = r.fixed();
    const max = r.fixed();
    axes.push({ tag, min, default: def, max, name: names.get(r.u16At(at + 18)) ?? tag });
  }
  const instances: NamedInstance[] = [];
  const instancesAt = axesAt + axisCount * axisSize;
  for (let i = 0; i < instanceCount; i++) {
    const at = instancesAt + i * instanceSize;
    const coordinates: Record<string, number> = {};
    axes.forEach((axis, a) => {
      coordinates[axis.tag] = r.seek(at + 4 + a * 4).fixed();
    });
    const hasPostScriptName = instanceSize >= axisCount * 4 + 6;
    instances.push({
      name: names.get(r.u16At(at)) ?? `Instance ${i + 1}`,
      postScriptName: hasPostScriptName ? names.get(r.u16At(at + 4 + axisCount * 4)) : undefined,
      coordinates,
    });
  }
  return { axes, instances };
}

/**
 * Converts axis values in user units (weight 700) to the normalised −1…1 scale the variation
 * tables use, including the `avar` remapping. Values outside an axis's range are clamped.
 */
export function normalizeCoordinates(
  axes: readonly VariationAxis[],
  avar: Uint8Array | undefined,
  settings: Readonly<Record<string, number>>,
): number[] {
  const coords = axes.map((axis) => {
    const value = Math.min(Math.max(settings[axis.tag] ?? axis.default, axis.min), axis.max);
    if (value < axis.default) return -(axis.default - value) / (axis.default - axis.min);
    if (value > axis.default) return (value - axis.default) / (axis.max - axis.default);
    return 0;
  });
  if (avar && avar.length >= 8) {
    const r = new BinaryReader(avar);
    let at = 8;
    for (let a = 0; a < Math.min(r.u16At(6), coords.length); a++) {
      const count = r.u16At(at);
      const value = coords[a] as number;
      for (let i = 1; i < count; i++) {
        const fromLow = f2dot14(r, at + 2 + (i - 1) * 4);
        const toLow = f2dot14(r, at + 4 + (i - 1) * 4);
        const fromHigh = f2dot14(r, at + 2 + i * 4);
        const toHigh = f2dot14(r, at + 4 + i * 4);
        if (value >= fromLow && value <= fromHigh) {
          coords[a] =
            fromHigh === fromLow
              ? toLow
              : toLow + ((value - fromLow) * (toHigh - toLow)) / (fromHigh - fromLow);
          break;
        }
      }
      at += 2 + count * 4;
    }
  }
  // Kept at full precision rather than rounded to the 2.14 fixed point the tables use, which is
  // what current HarfBuzz does; rounding here shifts some advances by a unit.
  return coords;
}

/** A set of deltas indexed by (outer, inner), shared by HVAR, MVAR and GDEF. */
export class ItemVariationStore {
  readonly #r: BinaryReader;
  readonly #base: number;
  /** How much each region applies at the current coordinates. */
  readonly #scalars: number[] = [];

  constructor(table: Uint8Array, offset: number, coords: readonly number[]) {
    const r = new BinaryReader(table);
    this.#r = r;
    this.#base = offset;
    const regions = offset + r.u32At(offset + 2);
    const axisCount = r.u16At(regions);
    const regionCount = r.u16At(regions + 2);
    for (let i = 0; i < regionCount; i++) {
      let scalar = 1;
      for (let a = 0; a < axisCount; a++) {
        const at = regions + 4 + (i * axisCount + a) * 6;
        const start = f2dot14(r, at);
        const peak = f2dot14(r, at + 2);
        const end = f2dot14(r, at + 4);
        const value = coords[a] ?? 0;
        if (peak === 0 || start > peak || peak > end || (start < 0 && end > 0)) continue;
        if (value === peak) continue;
        if (value <= start || value >= end) {
          scalar = 0;
          break;
        }
        // Single precision, like HarfBuzz and FreeType, so that deltas which land on a half
        // round the same way as they do there.
        scalar = Math.fround(
          scalar *
            Math.fround(
              value < peak ? (value - start) / (peak - start) : (end - value) / (end - peak),
            ),
        );
      }
      this.#scalars.push(scalar);
    }
  }

  delta(outer: number, inner: number): number {
    const r = this.#r;
    if (outer >= r.u16At(this.#base + 6)) return 0;
    const data = this.#base + r.u32At(this.#base + 8 + outer * 4);
    const itemCount = r.u16At(data);
    if (inner >= itemCount) return 0;
    let wordCount = r.u16At(data + 2);
    const longWords = (wordCount & 0x8000) !== 0;
    wordCount &= 0x7fff;
    const regionCount = r.u16At(data + 4);
    const wordSize = longWords ? 4 : 2;
    const restSize = longWords ? 2 : 1;
    const rowSize = wordCount * wordSize + (regionCount - wordCount) * restSize;
    let at = data + 6 + regionCount * 2 + inner * rowSize;
    let total = 0;
    for (let i = 0; i < regionCount; i++) {
      const scalar = this.#scalars[r.u16At(data + 6 + i * 2)] ?? 0;
      let value: number;
      if (i < wordCount) {
        value = longWords ? r.seek(at).i32() : r.i16At(at);
        at += wordSize;
      } else {
        value = longWords ? r.i16At(at) : (r.seek(at).u8() << 24) >> 24;
        at += restSize;
      }
      total = Math.fround(total + Math.fround(scalar * value));
    }
    return total;
  }
}

/** Advance-width deltas from the HVAR table. */
export class AdvanceVariations {
  readonly #store: ItemVariationStore;
  readonly #r: BinaryReader;
  readonly #map: number;

  constructor(table: Uint8Array, coords: readonly number[]) {
    this.#r = new BinaryReader(table);
    this.#store = new ItemVariationStore(table, this.#r.u32At(4), coords);
    this.#map = this.#r.u32At(8);
  }

  delta(glyph: number): number {
    const r = this.#r;
    const map = this.#map;
    if (map === 0) return this.#store.delta(0, glyph);
    const format = r.seek(map).u8();
    const entryFormat = r.u8();
    const count = format === 0 ? r.u16() : r.u32();
    if (count === 0) return this.#store.delta(0, glyph);
    const entrySize = ((entryFormat & 0x30) >> 4) + 1;
    const innerBits = (entryFormat & 0x0f) + 1;
    let at = r.offset + Math.min(glyph, count - 1) * entrySize;
    let entry = 0;
    for (let i = 0; i < entrySize; i++) entry = entry * 256 + r.seek(at++).u8();
    return this.#store.delta(Math.floor(entry / 2 ** innerBits), entry % 2 ** innerBits);
  }
}

/** Deltas for font-wide metrics from the MVAR table, by tag (`hasc`, `xhgt`, `undo`, …). */
export function metricDeltas(
  table: Uint8Array | undefined,
  coords: readonly number[],
): Map<string, number> {
  const deltas = new Map<string, number>();
  if (!table || table.length < 12) return deltas;
  const r = new BinaryReader(table);
  const recordSize = r.u16At(6);
  const count = r.u16At(8);
  const storeOffset = r.u16At(10);
  if (storeOffset === 0) return deltas;
  const store = new ItemVariationStore(table, storeOffset, coords);
  for (let i = 0; i < count; i++) {
    const at = 12 + i * recordSize;
    deltas.set(r.seek(at).tag(), store.delta(r.u16At(at + 4), r.u16At(at + 6)));
  }
  return deltas;
}
