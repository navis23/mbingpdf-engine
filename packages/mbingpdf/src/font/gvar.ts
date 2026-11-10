/** Glyph outline variations (the `gvar` table). */
import type { Glyph } from "./glyf.ts";
import { ARGS_ARE_XY_VALUES } from "./glyf.ts";
import { BinaryReader } from "./reader.ts";

// Tuple variation header flags.
const EMBEDDED_PEAK_TUPLE = 0x8000;
const INTERMEDIATE_REGION = 0x4000;
const PRIVATE_POINT_NUMBERS = 0x2000;
const SHARED_POINT_NUMBERS = 0x8000;

/** Deltas for each point of a glyph plus its four phantom points. */
export interface GlyphDeltas {
  readonly x: Float64Array;
  readonly y: Float64Array;
}

/** Reads packed point numbers. Returns undefined when the data means "all points". */
function readPoints(r: BinaryReader): number[] | undefined {
  let count = r.u8();
  if (count === 0) return undefined;
  if (count & 0x80) count = ((count & 0x7f) << 8) | r.u8();
  const points: number[] = [];
  let point = 0;
  while (points.length < count) {
    const control = r.u8();
    const run = (control & 0x7f) + 1;
    for (let i = 0; i < run && points.length < count; i++) {
      point += control & 0x80 ? r.u16() : r.u8();
      points.push(point);
    }
  }
  return points;
}

function readDeltas(r: BinaryReader, count: number): number[] {
  const deltas: number[] = [];
  while (deltas.length < count) {
    const control = r.u8();
    const run = (control & 0x3f) + 1;
    for (let i = 0; i < run && deltas.length < count; i++) {
      if (control & 0x80) deltas.push(0);
      else if (control & 0x40) deltas.push(r.i16());
      else deltas.push((r.u8() << 24) >> 24);
    }
  }
  return deltas;
}

/** Infers the delta of an untouched point from its two touched neighbours on the contour. */
function interpolate(
  coordinate: number,
  coordinate1: number,
  coordinate2: number,
  delta1: number,
  delta2: number,
): number {
  if (coordinate1 === coordinate2) return delta1 === delta2 ? delta1 : 0;
  if (coordinate <= Math.min(coordinate1, coordinate2))
    return coordinate1 < coordinate2 ? delta1 : delta2;
  if (coordinate >= Math.max(coordinate1, coordinate2))
    return coordinate1 > coordinate2 ? delta1 : delta2;
  return delta1 + ((coordinate - coordinate1) * (delta2 - delta1)) / (coordinate2 - coordinate1);
}

/** "Interpolation of untouched points": fills in deltas for points a tuple did not list. */
function interpolateUntouched(
  endPoints: readonly number[],
  x: readonly number[],
  y: readonly number[],
  dx: Float64Array,
  dy: Float64Array,
  touched: Uint8Array,
): void {
  let start = 0;
  for (const end of endPoints) {
    const first = touched.indexOf(1, start);
    if (first >= 0 && first <= end) {
      const length = end - start + 1;
      let from = first;
      // Walk once around the contour, from each touched point to the next.
      do {
        let to = from;
        do {
          to = start + ((to - start + 1) % length);
        } while (!touched[to]);
        for (
          let p = start + ((from - start + 1) % length);
          p !== to;
          p = start + ((p - start + 1) % length)
        ) {
          dx[p] = interpolate(
            x[p] as number,
            x[from] as number,
            x[to] as number,
            dx[from] as number,
            dx[to] as number,
          );
          dy[p] = interpolate(
            y[p] as number,
            y[from] as number,
            y[to] as number,
            dy[from] as number,
            dy[to] as number,
          );
        }
        from = to;
      } while (from !== first);
    }
    start = end + 1;
  }
}

export class GlyphVariations {
  readonly #r: BinaryReader;
  readonly #coords: readonly number[];
  readonly #axisCount: number;
  readonly #sharedTuples: number;
  readonly #sharedTupleCount: number;
  readonly #dataStart: number;
  readonly #longOffsets: boolean;
  readonly #glyphCount: number;

  constructor(table: Uint8Array, coords: readonly number[]) {
    const r = new BinaryReader(table);
    this.#r = r;
    this.#coords = coords;
    this.#axisCount = r.u16At(4);
    this.#sharedTupleCount = r.u16At(6);
    this.#sharedTuples = r.u32At(8);
    this.#glyphCount = r.u16At(12);
    this.#longOffsets = (r.u16At(14) & 1) !== 0;
    this.#dataStart = r.u32At(16);
  }

  /** How much a tuple applies at the current coordinates. */
  #scalar(peakAt: number, intermediateAt: number): number {
    const r = this.#r;
    let scalar = 1;
    for (let a = 0; a < this.#axisCount; a++) {
      const peak = r.i16At(peakAt + a * 2) / 16384;
      if (peak === 0) continue;
      const value = this.#coords[a] ?? 0;
      if (value === 0) return 0;
      if (intermediateAt >= 0) {
        const start = r.i16At(intermediateAt + a * 2) / 16384;
        const end = r.i16At(intermediateAt + (this.#axisCount + a) * 2) / 16384;
        if (value < start || value > end) return 0;
        if (value === peak) continue;
        scalar *= value < peak ? (value - start) / (peak - start) : (end - value) / (end - peak);
      } else {
        if (value < Math.min(0, peak) || value > Math.max(0, peak)) return 0;
        scalar *= value / peak;
      }
    }
    return scalar;
  }

  /** The deltas for one glyph at the current coordinates, or undefined when it does not vary. */
  deltas(glyphId: number, glyph: Glyph): GlyphDeltas | undefined {
    const r = this.#r;
    if (glyphId >= this.#glyphCount) return undefined;
    const offset = (i: number): number =>
      this.#longOffsets ? r.u32At(20 + i * 4) : r.u16At(20 + i * 2) * 2;
    const start = this.#dataStart + offset(glyphId);
    const end = this.#dataStart + offset(glyphId + 1);
    if (end - start < 4) return undefined;

    const pointCount = (glyph.kind === "simple" ? glyph.x.length : glyph.components.length) + 4;
    const totalX = new Float64Array(pointCount);
    const totalY = new Float64Array(pointCount);

    const header = r.u16At(start);
    const tupleCount = header & 0x0fff;
    const data = new BinaryReader(r.bytes, start + r.u16At(start + 2));
    const sharedPoints = header & SHARED_POINT_NUMBERS ? readPoints(data) : undefined;
    const hasSharedPoints = (header & SHARED_POINT_NUMBERS) !== 0;

    let headerAt = start + 4;
    let dataAt = data.offset;
    let varies = false;
    for (let t = 0; t < tupleCount; t++) {
      const size = r.u16At(headerAt);
      const tupleIndex = r.u16At(headerAt + 2);
      headerAt += 4;
      let peakAt: number;
      if (tupleIndex & EMBEDDED_PEAK_TUPLE) {
        peakAt = headerAt;
        headerAt += this.#axisCount * 2;
      } else {
        const shared = tupleIndex & 0x0fff;
        if (shared >= this.#sharedTupleCount) return undefined;
        peakAt = this.#sharedTuples + shared * this.#axisCount * 2;
      }
      let intermediateAt = -1;
      if (tupleIndex & INTERMEDIATE_REGION) {
        intermediateAt = headerAt;
        headerAt += this.#axisCount * 4;
      }
      const tupleData = new BinaryReader(r.bytes, dataAt);
      dataAt += size;

      const scalar = this.#scalar(peakAt, intermediateAt);
      if (scalar === 0) continue;

      let points: number[] | undefined;
      if (tupleIndex & PRIVATE_POINT_NUMBERS) points = readPoints(tupleData);
      else if (hasSharedPoints) points = sharedPoints;
      const count = points ? points.length : pointCount;
      const xs = readDeltas(tupleData, count);
      const ys = readDeltas(tupleData, count);

      varies = true;
      if (!points) {
        for (let i = 0; i < pointCount; i++) {
          totalX[i] = (totalX[i] as number) + (xs[i] as number) * scalar;
          totalY[i] = (totalY[i] as number) + (ys[i] as number) * scalar;
        }
        continue;
      }
      const dx = new Float64Array(pointCount);
      const dy = new Float64Array(pointCount);
      const touched = new Uint8Array(pointCount);
      points.forEach((point, i) => {
        if (point < pointCount) {
          dx[point] = xs[i] as number;
          dy[point] = ys[i] as number;
          touched[point] = 1;
        }
      });
      if (glyph.kind === "simple") {
        interpolateUntouched(glyph.endPoints, glyph.x, glyph.y, dx, dy, touched);
      }
      for (let i = 0; i < pointCount; i++) {
        totalX[i] = (totalX[i] as number) + (dx[i] as number) * scalar;
        totalY[i] = (totalY[i] as number) + (dy[i] as number) * scalar;
      }
    }
    return varies ? { x: totalX, y: totalY } : undefined;
  }
}

/** Moves a glyph's points (or its components' offsets) by the given deltas, in place. */
export function applyDeltas(glyph: Glyph, deltas: GlyphDeltas): void {
  if (glyph.kind === "simple") {
    for (let i = 0; i < glyph.x.length; i++) {
      glyph.x[i] = Math.round((glyph.x[i] as number) + (deltas.x[i] as number));
      glyph.y[i] = Math.round((glyph.y[i] as number) + (deltas.y[i] as number));
    }
    return;
  }
  glyph.components.forEach((component, i) => {
    if (component.flags & ARGS_ARE_XY_VALUES) {
      component.arg1 = Math.round(component.arg1 + (deltas.x[i] as number));
      component.arg2 = Math.round(component.arg2 + (deltas.y[i] as number));
    }
  });
}
