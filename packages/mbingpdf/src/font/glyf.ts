/** Reading and writing glyph outlines in the `glyf` table format. */
import { BinaryReader, BinaryWriter } from "./reader.ts";

// Simple glyph flags.
const ON_CURVE = 0x01;
const X_SHORT = 0x02;
const Y_SHORT = 0x04;
const REPEAT = 0x08;
const X_SAME_OR_POSITIVE = 0x10;
const Y_SAME_OR_POSITIVE = 0x20;
const OVERLAP_SIMPLE = 0x40;

// Composite glyph flags.
export const ARG_1_AND_2_ARE_WORDS = 0x0001;
export const ARGS_ARE_XY_VALUES = 0x0002;
export const WE_HAVE_A_SCALE = 0x0008;
export const MORE_COMPONENTS = 0x0020;
export const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
export const WE_HAVE_A_TWO_BY_TWO = 0x0080;
const WE_HAVE_INSTRUCTIONS = 0x0100;

export interface SimpleGlyph {
  readonly kind: "simple";
  /** Index of the last point of each contour. */
  readonly endPoints: number[];
  readonly x: number[];
  readonly y: number[];
  readonly onCurve: boolean[];
  /** Contours may overlap; renderers must fill with the non-zero rule. */
  readonly overlap: boolean;
}

export interface GlyphComponent {
  glyph: number;
  flags: number;
  /** The offset when `flags` has ARGS_ARE_XY_VALUES, otherwise point numbers to match. */
  arg1: number;
  arg2: number;
  /** The raw bytes of the scale or 2×2 matrix, if any. */
  readonly transform: Uint8Array;
}

export interface CompositeGlyph {
  readonly kind: "composite";
  readonly components: GlyphComponent[];
  readonly bbox: [number, number, number, number];
}

export type Glyph = SimpleGlyph | CompositeGlyph;

export function decodeGlyph(data: Uint8Array): Glyph | undefined {
  if (data.length < 10) return undefined;
  const r = new BinaryReader(data);
  const contours = r.i16();
  const bbox: [number, number, number, number] = [r.i16(), r.i16(), r.i16(), r.i16()];
  if (contours < 0) {
    const components: GlyphComponent[] = [];
    let flags: number;
    do {
      flags = r.u16();
      const glyph = r.u16();
      let arg1: number;
      let arg2: number;
      if (flags & ARG_1_AND_2_ARE_WORDS) {
        arg1 = flags & ARGS_ARE_XY_VALUES ? r.i16() : r.u16();
        arg2 = flags & ARGS_ARE_XY_VALUES ? r.i16() : r.u16();
      } else if (flags & ARGS_ARE_XY_VALUES) {
        arg1 = (r.u8() << 24) >> 24;
        arg2 = (r.u8() << 24) >> 24;
      } else {
        arg1 = r.u8();
        arg2 = r.u8();
      }
      let size = 0;
      if (flags & WE_HAVE_A_SCALE) size = 2;
      else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) size = 4;
      else if (flags & WE_HAVE_A_TWO_BY_TWO) size = 8;
      components.push({
        glyph,
        flags,
        arg1,
        arg2,
        transform: data.subarray(r.offset, r.offset + size),
      });
      r.skip(size);
    } while (flags & MORE_COMPONENTS);
    return { kind: "composite", components, bbox };
  }

  const endPoints: number[] = [];
  for (let i = 0; i < contours; i++) endPoints.push(r.u16());
  const count = contours === 0 ? 0 : (endPoints.at(-1) as number) + 1;
  r.skip(r.u16()); // instructions
  const flags: number[] = [];
  while (flags.length < count) {
    const flag = r.u8();
    flags.push(flag);
    if (flag & REPEAT) {
      for (let repeat = r.u8(); repeat > 0 && flags.length < count; repeat--) flags.push(flag);
    }
  }
  const read = (short: number, same: number): number[] => {
    const values: number[] = [];
    let value = 0;
    for (const flag of flags) {
      if (flag & short) value += flag & same ? r.u8() : -r.u8();
      else if (!(flag & same)) value += r.i16();
      values.push(value);
    }
    return values;
  };
  const x = read(X_SHORT, X_SAME_OR_POSITIVE);
  const y = read(Y_SHORT, Y_SAME_OR_POSITIVE);
  return {
    kind: "simple",
    endPoints,
    x,
    y,
    onCurve: flags.map((flag) => (flag & ON_CURVE) !== 0),
    overlap: ((flags[0] ?? 0) & OVERLAP_SIMPLE) !== 0,
  };
}

/** Encodes a simple glyph without hinting instructions. Coordinates must be integers. */
export function encodeSimpleGlyph(glyph: SimpleGlyph): Uint8Array {
  const count = glyph.x.length;
  if (count === 0) return new Uint8Array(0);
  const out = new BinaryWriter();
  out.i16(glyph.endPoints.length);
  out.i16(Math.min(...glyph.x)).i16(Math.min(...glyph.y));
  out.i16(Math.max(...glyph.x)).i16(Math.max(...glyph.y));
  for (const end of glyph.endPoints) out.u16(end);
  out.u16(0);

  const flags: number[] = [];
  const xs = new BinaryWriter();
  const ys = new BinaryWriter();
  let previousX = 0;
  let previousY = 0;
  for (let i = 0; i < count; i++) {
    let flag = glyph.onCurve[i] ? ON_CURVE : 0;
    if (i === 0 && glyph.overlap) flag |= OVERLAP_SIMPLE;
    const dx = (glyph.x[i] as number) - previousX;
    const dy = (glyph.y[i] as number) - previousY;
    previousX += dx;
    previousY += dy;
    if (dx === 0) flag |= X_SAME_OR_POSITIVE;
    else if (dx > -256 && dx < 256) {
      flag |= X_SHORT | (dx > 0 ? X_SAME_OR_POSITIVE : 0);
      xs.u8(Math.abs(dx));
    } else xs.i16(dx);
    if (dy === 0) flag |= Y_SAME_OR_POSITIVE;
    else if (dy > -256 && dy < 256) {
      flag |= Y_SHORT | (dy > 0 ? Y_SAME_OR_POSITIVE : 0);
      ys.u8(Math.abs(dy));
    } else ys.i16(dy);
    flags.push(flag);
  }
  // Runs of identical flags are stored once with a repeat count.
  for (let i = 0; i < count; ) {
    const flag = flags[i] as number;
    let run = 1;
    while (i + run < count && flags[i + run] === flag && run < 256) run++;
    if (run > 1) out.u8(flag | REPEAT).u8(run - 1);
    else out.u8(flag);
    i += run;
  }
  out.bytes(xs.toBytes()).bytes(ys.toBytes());
  return out.toBytes();
}

/** Encodes a composite glyph without hinting instructions. */
export function encodeCompositeGlyph(glyph: CompositeGlyph): Uint8Array {
  const out = new BinaryWriter();
  out.i16(-1);
  for (const value of glyph.bbox) out.i16(value);
  glyph.components.forEach((component, i) => {
    let flags = component.flags & ~(WE_HAVE_INSTRUCTIONS | MORE_COMPONENTS | ARG_1_AND_2_ARE_WORDS);
    if (i < glyph.components.length - 1) flags |= MORE_COMPONENTS;
    const offsets = (flags & ARGS_ARE_XY_VALUES) !== 0;
    const fitsBytes = offsets
      ? component.arg1 >= -128 &&
        component.arg1 <= 127 &&
        component.arg2 >= -128 &&
        component.arg2 <= 127
      : component.arg1 <= 255 && component.arg2 <= 255;
    if (!fitsBytes) flags |= ARG_1_AND_2_ARE_WORDS;
    out.u16(flags).u16(component.glyph);
    if (!fitsBytes) {
      if (offsets) out.i16(component.arg1).i16(component.arg2);
      else out.u16(component.arg1).u16(component.arg2);
    } else {
      out.u8(component.arg1 & 0xff).u8(component.arg2 & 0xff);
    }
    out.bytes(component.transform);
  });
  return out.toBytes();
}
