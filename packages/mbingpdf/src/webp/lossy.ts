/**
 * The lossy WebP format: one VP8 key frame (RFC 6386). Decoding follows libwebp step for step
 * (edge samples, transforms, loop filter, and the "fancy" chroma upsampling of its RGB output),
 * so the pixels are the ones libwebp, and so most browsers, produce.
 */
import { AC_TABLE, BMODE_PROBA, COEFF_PROBA, COEFF_UPDATE_PROBA, DC_TABLE } from "./tables.ts";

const cutShort = (): Error => new Error("The WebP image data is cut short");
const corrupt = (what: string): Error => new Error(`The WebP image data is damaged: ${what}`);

/** The boolean entropy decoder of RFC 6386 section 7. */
class BoolDecoder {
  private value: number;
  private range = 255;
  private shifts = 0;
  private position: number;
  /** Bytes asked for past the end of the partition. */
  overrun = 0;
  private readonly data: Uint8Array;
  private readonly end: number;

  constructor(data: Uint8Array, start: number, end: number) {
    this.data = data;
    this.end = end;
    this.position = start;
    this.value = (this.next() << 8) | this.next();
  }

  private next(): number {
    if (this.position < this.end) return this.data[this.position++] as number;
    this.overrun++;
    return 0;
  }

  bit(probability: number): number {
    const split = 1 + (((this.range - 1) * probability) >> 8);
    const big = split << 8;
    let bit: number;
    if (this.value >= big) {
      bit = 1;
      this.range -= split;
      this.value -= big;
    } else {
      bit = 0;
      this.range = split;
    }
    while (this.range < 128) {
      this.value <<= 1;
      this.range <<= 1;
      if (++this.shifts === 8) {
        this.shifts = 0;
        this.value |= this.next();
      }
    }
    return bit;
  }

  literal(bits: number): number {
    let value = 0;
    while (bits-- > 0) value = (value << 1) | this.bit(128);
    return value;
  }

  signed(bits: number): number {
    const value = this.literal(bits);
    return this.bit(128) ? -value : value;
  }

  /** Whether more was read than the data holds (libwebp reads one byte less far ahead). */
  get exhausted(): boolean {
    return this.overrun > 2;
  }
}

// Intra modes, numbered as libwebp numbers them. The 16×16 and chroma modes share the first
// four numbers with the 4×4 modes they correspond to.
const DC = 0;
const TM = 1;
const VE = 2;
const HE = 3;
const RD = 4;
const VR = 5;
const LD = 6;
const VL = 7;
const HD = 8;
const HU = 9;
// DC prediction where the top row, the left column or both are outside the picture.
const DC_NO_TOP = 10;
const DC_NO_LEFT = 11;
const DC_NO_TOP_LEFT = 12;

/** The tree of the 4×4 intra modes: a positive entry is the next node, a negative one a mode. */
const BMODE_TREE = [-DC, 1, -TM, 2, -VE, 3, 4, 6, -HE, 5, -RD, -VR, -LD, 7, -VL, 8, -HD, -HU];

const ZIGZAG = [0, 1, 4, 8, 5, 2, 3, 6, 9, 12, 13, 10, 7, 11, 14, 15];
/** The probability band of each coefficient position (with a sentinel for position 16). */
const BANDS = [0, 1, 2, 3, 6, 4, 5, 6, 6, 6, 6, 6, 6, 6, 6, 7, 0];
const CAT3456 = [
  [173, 148, 140],
  [176, 155, 140, 135],
  [180, 157, 141, 134, 130],
  [254, 254, 243, 230, 196, 177, 153, 140, 133, 130, 129],
];

// Work buffers hold one macroblock with its left column, top row and top-right samples, as
// libwebp's do: 32 bytes a row, the block starting at column 8 of row 1.
const BPS = 32;
const Y_OFFSET = BPS + 8;
const UV_OFFSET = BPS + 8;

const clip255 = (v: number): number => (v < 0 ? 0 : Math.min(v, 255));
const avg3 = (a: number, b: number, c: number): number => (a + 2 * b + c + 2) >> 2;
const avg2 = (a: number, b: number): number => (a + b + 1) >> 1;

interface Quantizer {
  readonly y1: [number, number];
  readonly y2: [number, number];
  readonly uv: [number, number];
}

interface FilterInfo {
  /** 0 when the macroblock is not filtered. */
  readonly limit: number;
  readonly interior: number;
  readonly hevThreshold: number;
}

/** Reads the coefficients of one 4×4 block; returns the position after the last one coded. */
function readCoefficients(
  decoder: BoolDecoder,
  probas: Uint8Array,
  type: number,
  context: number,
  quant: [number, number],
  first: number,
  out: Int16Array,
  offset: number,
): number {
  const base = type * 8 * 3 * 11;
  let p = base + ((BANDS[first] as number) * 3 + context) * 11;
  for (let n = first; n < 16; n++) {
    if (!decoder.bit(probas[p] as number)) return n; // end of block
    while (!decoder.bit(probas[p + 1] as number)) {
      // a zero
      n++;
      if (n === 16) return 16;
      p = base + (BANDS[n] as number) * 3 * 11;
    }
    const band = base + (BANDS[n + 1] as number) * 3 * 11;
    let value: number;
    if (!decoder.bit(probas[p + 2] as number)) {
      value = 1;
      p = band + 11;
    } else {
      value = largeValue(decoder, probas, p);
      p = band + 22;
    }
    const sign = decoder.bit(128);
    out[offset + (ZIGZAG[n] as number)] = (sign ? -value : value) * quant[n > 0 ? 1 : 0];
  }
  return 16;
}

function largeValue(decoder: BoolDecoder, probas: Uint8Array, p: number): number {
  if (!decoder.bit(probas[p + 3] as number)) {
    if (!decoder.bit(probas[p + 4] as number)) return 2;
    return 3 + decoder.bit(probas[p + 5] as number);
  }
  if (!decoder.bit(probas[p + 6] as number)) {
    if (!decoder.bit(probas[p + 7] as number)) return 5 + decoder.bit(159);
    return 7 + 2 * decoder.bit(165) + decoder.bit(145);
  }
  const high = decoder.bit(probas[p + 8] as number);
  const low = decoder.bit(probas[p + 9 + high] as number);
  const category = 2 * high + low;
  let value = 0;
  for (const probability of CAT3456[category] as number[])
    value = 2 * value + decoder.bit(probability);
  return value + 3 + (8 << category);
}

/** The inverse Walsh–Hadamard transform: the DC of each luma block from the Y2 block. */
function inverseWht(input: Int16Array, out: Int16Array): void {
  const tmp = new Int32Array(16);
  for (let i = 0; i < 4; i++) {
    const a0 = (input[i] as number) + (input[12 + i] as number);
    const a1 = (input[4 + i] as number) + (input[8 + i] as number);
    const a2 = (input[4 + i] as number) - (input[8 + i] as number);
    const a3 = (input[i] as number) - (input[12 + i] as number);
    tmp[i] = a0 + a1;
    tmp[8 + i] = a0 - a1;
    tmp[4 + i] = a3 + a2;
    tmp[12 + i] = a3 - a2;
  }
  for (let i = 0; i < 4; i++) {
    const dc = (tmp[i * 4] as number) + 3;
    const a0 = dc + (tmp[3 + i * 4] as number);
    const a1 = (tmp[1 + i * 4] as number) + (tmp[2 + i * 4] as number);
    const a2 = (tmp[1 + i * 4] as number) - (tmp[2 + i * 4] as number);
    const a3 = dc - (tmp[3 + i * 4] as number);
    out[i * 64] = (a0 + a1) >> 3;
    out[i * 64 + 16] = (a3 + a2) >> 3;
    out[i * 64 + 32] = (a0 - a1) >> 3;
    out[i * 64 + 48] = (a3 - a2) >> 3;
  }
}

const mul1 = (a: number): number => ((a * 20091) >> 16) + a;
const mul2 = (a: number): number => (a * 35468) >> 16;
const idctTemp = new Int32Array(16);

/** Adds the inverse DCT of a block's coefficients to the 4×4 pixels at `at`. */
function addTransform(
  coefficients: Int16Array,
  offset: number,
  buffer: Uint8Array,
  at: number,
): void {
  let nonzero = false;
  for (let i = 0; i < 16; i++) {
    if (coefficients[offset + i] !== 0) {
      nonzero = true;
      break;
    }
  }
  if (!nonzero) return;
  const tmp = idctTemp;
  for (let i = 0; i < 4; i++) {
    const c0 = coefficients[offset + i] as number;
    const c4 = coefficients[offset + 4 + i] as number;
    const c8 = coefficients[offset + 8 + i] as number;
    const c12 = coefficients[offset + 12 + i] as number;
    const a = c0 + c8;
    const b = c0 - c8;
    const c = mul2(c4) - mul1(c12);
    const d = mul1(c4) + mul2(c12);
    tmp[i * 4] = a + d;
    tmp[i * 4 + 1] = b + c;
    tmp[i * 4 + 2] = b - c;
    tmp[i * 4 + 3] = a - d;
  }
  for (let i = 0; i < 4; i++) {
    const dc = (tmp[i] as number) + 4;
    const a = dc + (tmp[8 + i] as number);
    const b = dc - (tmp[8 + i] as number);
    const c = mul2(tmp[4 + i] as number) - mul1(tmp[12 + i] as number);
    const d = mul1(tmp[4 + i] as number) + mul2(tmp[12 + i] as number);
    const row = at + i * BPS;
    buffer[row] = clip255((buffer[row] as number) + ((a + d) >> 3));
    buffer[row + 1] = clip255((buffer[row + 1] as number) + ((b + c) >> 3));
    buffer[row + 2] = clip255((buffer[row + 2] as number) + ((b - c) >> 3));
    buffer[row + 3] = clip255((buffer[row + 3] as number) + ((a - d) >> 3));
  }
}

function fill(buffer: Uint8Array, at: number, size: number, value: number): void {
  for (let y = 0; y < size; y++) {
    const row = at + y * BPS;
    for (let x = 0; x < size; x++) buffer[row + x] = value;
  }
}

/**
 * Loads a macroblock's left column, top row and top-left sample into its work buffer, from the
 * picture decoded so far; outside the picture they are 129 (left) and 127 (top).
 */
function loadEdges(
  buffer: Uint8Array,
  plane: Uint8Array,
  size: number,
  stride: number,
  at: number,
  mbX: number,
  mbY: number,
): void {
  const origin = BPS + 8;
  for (let j = 0; j < size; j++) {
    buffer[origin + j * BPS - 1] = mbX > 0 ? (plane[at + j * stride - 1] as number) : 129;
  }
  const top = origin - BPS;
  if (mbY > 0) {
    for (let x = 0; x < size; x++) buffer[top + x] = plane[at - stride + x] as number;
    buffer[top - 1] = mbX > 0 ? (plane[at - stride - 1] as number) : 129;
  } else {
    for (let x = -1; x < size; x++) buffer[top + x] = 127;
  }
}

/** Copies a reconstructed block from its work buffer into the picture. */
function storeBlock(
  buffer: Uint8Array,
  plane: Uint8Array,
  size: number,
  stride: number,
  at: number,
): void {
  const origin = BPS + 8;
  for (let y = 0; y < size; y++) {
    const from = origin + y * BPS;
    const to = at + y * stride;
    for (let x = 0; x < size; x++) plane[to + x] = buffer[from + x] as number;
  }
}

/** Predicts a square block of `size` (16 for luma, 8 for chroma) with a whole-block mode. */
function predictBlock(buffer: Uint8Array, at: number, size: number, mode: number): void {
  const shift = size === 16 ? 4 : 3;
  switch (mode) {
    case DC: {
      let sum = size;
      for (let i = 0; i < size; i++)
        sum += (buffer[at - BPS + i] as number) + (buffer[at - 1 + i * BPS] as number);
      fill(buffer, at, size, sum >> (shift + 1));
      return;
    }
    case DC_NO_TOP: {
      let sum = size >> 1;
      for (let i = 0; i < size; i++) sum += buffer[at - 1 + i * BPS] as number;
      fill(buffer, at, size, sum >> shift);
      return;
    }
    case DC_NO_LEFT: {
      let sum = size >> 1;
      for (let i = 0; i < size; i++) sum += buffer[at - BPS + i] as number;
      fill(buffer, at, size, sum >> shift);
      return;
    }
    case DC_NO_TOP_LEFT:
      fill(buffer, at, size, 0x80);
      return;
    case VE:
      for (let y = 0; y < size; y++) buffer.copyWithin(at + y * BPS, at - BPS, at - BPS + size);
      return;
    case HE:
      for (let y = 0; y < size; y++) {
        const row = at + y * BPS;
        buffer.fill(buffer[row - 1] as number, row, row + size);
      }
      return;
    default:
      trueMotion(buffer, at, size);
  }
}

function trueMotion(buffer: Uint8Array, at: number, size: number): void {
  const topLeft = buffer[at - BPS - 1] as number;
  for (let y = 0; y < size; y++) {
    const row = at + y * BPS;
    const left = (buffer[row - 1] as number) - topLeft;
    for (let x = 0; x < size; x++)
      buffer[row + x] = clip255((buffer[at - BPS + x] as number) + left);
  }
}

/** Predicts a 4×4 luma block. */
function predict4(b: Uint8Array, at: number, mode: number): void {
  const top = at - BPS;
  const I = b[at - 1] as number;
  const J = b[at - 1 + BPS] as number;
  const K = b[at - 1 + 2 * BPS] as number;
  const L = b[at - 1 + 3 * BPS] as number;
  const X = b[top - 1] as number;
  const A = b[top] as number;
  const B = b[top + 1] as number;
  const C = b[top + 2] as number;
  const D = b[top + 3] as number;
  const E = b[top + 4] as number;
  const F = b[top + 5] as number;
  const G = b[top + 6] as number;
  const H = b[top + 7] as number;
  switch (mode) {
    case DC: {
      let sum = 4;
      for (let i = 0; i < 4; i++) sum += (b[top + i] as number) + (b[at - 1 + i * BPS] as number);
      fill(b, at, 4, sum >> 3);
      return;
    }
    case TM:
      trueMotion(b, at, 4);
      return;
    case VE: {
      const values = [avg3(X, A, B), avg3(A, B, C), avg3(B, C, D), avg3(C, D, E)];
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++) b[at + x + y * BPS] = values[x] as number;
      return;
    }
    case HE: {
      const values = [avg3(X, I, J), avg3(I, J, K), avg3(J, K, L), avg3(K, L, L)];
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++) b[at + x + y * BPS] = values[y] as number;
      return;
    }
    case RD:
      b[at + 96] = avg3(J, K, L);
      b[at + 97] = avg3(I, J, K);
      b[at + 64] = avg3(I, J, K);
      b[at + 98] = avg3(X, I, J);
      b[at + 65] = avg3(X, I, J);
      b[at + 32] = avg3(X, I, J);
      b[at + 99] = avg3(A, X, I);
      b[at + 66] = avg3(A, X, I);
      b[at + 33] = avg3(A, X, I);
      b[at + 0] = avg3(A, X, I);
      b[at + 67] = avg3(B, A, X);
      b[at + 34] = avg3(B, A, X);
      b[at + 1] = avg3(B, A, X);
      b[at + 35] = avg3(C, B, A);
      b[at + 2] = avg3(C, B, A);
      b[at + 3] = avg3(D, C, B);
      return;
    case LD:
      b[at + 0] = avg3(A, B, C);
      b[at + 1] = avg3(B, C, D);
      b[at + 32] = avg3(B, C, D);
      b[at + 2] = avg3(C, D, E);
      b[at + 33] = avg3(C, D, E);
      b[at + 64] = avg3(C, D, E);
      b[at + 3] = avg3(D, E, F);
      b[at + 34] = avg3(D, E, F);
      b[at + 65] = avg3(D, E, F);
      b[at + 96] = avg3(D, E, F);
      b[at + 35] = avg3(E, F, G);
      b[at + 66] = avg3(E, F, G);
      b[at + 97] = avg3(E, F, G);
      b[at + 67] = avg3(F, G, H);
      b[at + 98] = avg3(F, G, H);
      b[at + 99] = avg3(G, H, H);
      return;
    case VR:
      b[at + 0] = avg2(X, A);
      b[at + 65] = avg2(X, A);
      b[at + 1] = avg2(A, B);
      b[at + 66] = avg2(A, B);
      b[at + 2] = avg2(B, C);
      b[at + 67] = avg2(B, C);
      b[at + 3] = avg2(C, D);
      b[at + 96] = avg3(K, J, I);
      b[at + 64] = avg3(J, I, X);
      b[at + 32] = avg3(I, X, A);
      b[at + 97] = avg3(I, X, A);
      b[at + 33] = avg3(X, A, B);
      b[at + 98] = avg3(X, A, B);
      b[at + 34] = avg3(A, B, C);
      b[at + 99] = avg3(A, B, C);
      b[at + 35] = avg3(B, C, D);
      return;
    case VL:
      b[at + 0] = avg2(A, B);
      b[at + 1] = avg2(B, C);
      b[at + 64] = avg2(B, C);
      b[at + 2] = avg2(C, D);
      b[at + 65] = avg2(C, D);
      b[at + 3] = avg2(D, E);
      b[at + 66] = avg2(D, E);
      b[at + 32] = avg3(A, B, C);
      b[at + 33] = avg3(B, C, D);
      b[at + 96] = avg3(B, C, D);
      b[at + 34] = avg3(C, D, E);
      b[at + 97] = avg3(C, D, E);
      b[at + 35] = avg3(D, E, F);
      b[at + 98] = avg3(D, E, F);
      b[at + 67] = avg3(E, F, G);
      b[at + 99] = avg3(F, G, H);
      return;
    case HU:
      b[at + 0] = avg2(I, J);
      b[at + 2] = avg2(J, K);
      b[at + 32] = avg2(J, K);
      b[at + 34] = avg2(K, L);
      b[at + 64] = avg2(K, L);
      b[at + 1] = avg3(I, J, K);
      b[at + 3] = avg3(J, K, L);
      b[at + 33] = avg3(J, K, L);
      b[at + 35] = avg3(K, L, L);
      b[at + 65] = avg3(K, L, L);
      b[at + 67] = L;
      b[at + 66] = L;
      b[at + 96] = L;
      b[at + 97] = L;
      b[at + 98] = L;
      b[at + 99] = L;
      return;
    default: // HD
      b[at + 0] = avg2(I, X);
      b[at + 34] = avg2(I, X);
      b[at + 32] = avg2(J, I);
      b[at + 66] = avg2(J, I);
      b[at + 64] = avg2(K, J);
      b[at + 98] = avg2(K, J);
      b[at + 96] = avg2(L, K);
      b[at + 3] = avg3(A, B, C);
      b[at + 2] = avg3(X, A, B);
      b[at + 1] = avg3(I, X, A);
      b[at + 35] = avg3(I, X, A);
      b[at + 33] = avg3(J, I, X);
      b[at + 67] = avg3(J, I, X);
      b[at + 65] = avg3(K, J, I);
      b[at + 99] = avg3(K, J, I);
      b[at + 97] = avg3(L, K, J);
  }
}

// ---- Loop filter (RFC 6386 section 15, as libwebp writes it) ----

const sclip1 = (v: number): number => (v < -128 ? -128 : Math.min(v, 127));
const sclip2 = (v: number): number => (v < -16 ? -16 : Math.min(v, 15));

function filter2(p: Uint8Array, at: number, step: number): void {
  const p1 = p[at - 2 * step] as number;
  const p0 = p[at - step] as number;
  const q0 = p[at] as number;
  const q1 = p[at + step] as number;
  const a = 3 * (q0 - p0) + sclip1(p1 - q1);
  const a1 = sclip2((a + 4) >> 3);
  const a2 = sclip2((a + 3) >> 3);
  p[at - step] = clip255(p0 + a2);
  p[at] = clip255(q0 - a1);
}

function filter4(p: Uint8Array, at: number, step: number): void {
  const p1 = p[at - 2 * step] as number;
  const p0 = p[at - step] as number;
  const q0 = p[at] as number;
  const q1 = p[at + step] as number;
  const a = 3 * (q0 - p0);
  const a1 = sclip2((a + 4) >> 3);
  const a2 = sclip2((a + 3) >> 3);
  const a3 = (a1 + 1) >> 1;
  p[at - 2 * step] = clip255(p1 + a3);
  p[at - step] = clip255(p0 + a2);
  p[at] = clip255(q0 - a1);
  p[at + step] = clip255(q1 - a3);
}

function filter6(p: Uint8Array, at: number, step: number): void {
  const p2 = p[at - 3 * step] as number;
  const p1 = p[at - 2 * step] as number;
  const p0 = p[at - step] as number;
  const q0 = p[at] as number;
  const q1 = p[at + step] as number;
  const q2 = p[at + 2 * step] as number;
  const a = sclip1(3 * (q0 - p0) + sclip1(p1 - q1));
  const a1 = (27 * a + 63) >> 7;
  const a2 = (18 * a + 63) >> 7;
  const a3 = (9 * a + 63) >> 7;
  p[at - 3 * step] = clip255(p2 + a3);
  p[at - 2 * step] = clip255(p1 + a2);
  p[at - step] = clip255(p0 + a1);
  p[at] = clip255(q0 - a1);
  p[at + step] = clip255(q1 - a2);
  p[at + 2 * step] = clip255(q2 - a3);
}

function highVariance(p: Uint8Array, at: number, step: number, threshold: number): boolean {
  const p1 = p[at - 2 * step] as number;
  const p0 = p[at - step] as number;
  const q0 = p[at] as number;
  const q1 = p[at + step] as number;
  return Math.abs(p1 - p0) > threshold || Math.abs(q1 - q0) > threshold;
}

function needsFilter(p: Uint8Array, at: number, step: number, t: number): boolean {
  const p1 = p[at - 2 * step] as number;
  const p0 = p[at - step] as number;
  const q0 = p[at] as number;
  const q1 = p[at + step] as number;
  return 4 * Math.abs(p0 - q0) + Math.abs(p1 - q1) <= t;
}

function needsFilter2(p: Uint8Array, at: number, step: number, t: number, it: number): boolean {
  const p3 = p[at - 4 * step] as number;
  const p2 = p[at - 3 * step] as number;
  const p1 = p[at - 2 * step] as number;
  const p0 = p[at - step] as number;
  const q0 = p[at] as number;
  const q1 = p[at + step] as number;
  const q2 = p[at + 2 * step] as number;
  const q3 = p[at + 3 * step] as number;
  if (4 * Math.abs(p0 - q0) + Math.abs(p1 - q1) > t) return false;
  return (
    Math.abs(p3 - p2) <= it &&
    Math.abs(p2 - p1) <= it &&
    Math.abs(p1 - p0) <= it &&
    Math.abs(q3 - q2) <= it &&
    Math.abs(q2 - q1) <= it &&
    Math.abs(q1 - q0) <= it
  );
}

/** The simple filter across one edge of `size` pixels; `step` crosses the edge, `along` follows it. */
function simpleEdge(
  p: Uint8Array,
  at: number,
  step: number,
  along: number,
  threshold: number,
): void {
  const t = 2 * threshold + 1;
  for (let i = 0; i < 16; i++) {
    const here = at + i * along;
    if (needsFilter(p, here, step, t)) filter2(p, here, step);
  }
}

/** The normal filter across one edge: `wide` on macroblock edges, the 4-tap one inside. */
function normalEdge(
  p: Uint8Array,
  at: number,
  step: number,
  along: number,
  size: number,
  threshold: number,
  interior: number,
  hevThreshold: number,
  wide: boolean,
): void {
  const t = 2 * threshold + 1;
  for (let i = 0; i < size; i++) {
    const here = at + i * along;
    if (!needsFilter2(p, here, step, t, interior)) continue;
    if (highVariance(p, here, step, hevThreshold)) filter2(p, here, step);
    else if (wide) filter6(p, here, step);
    else filter4(p, here, step);
  }
}

// ---- Colour conversion, as libwebp's YUV to RGB with 14-bit precision ----

const multHi = (v: number, coefficient: number): number => (v * coefficient) >> 8;
const clip8 = (v: number): number => ((v & ~16383) === 0 ? v >> 6 : v < 0 ? 0 : 255);

function writeRgb(out: Uint8Array, at: number, y: number, u: number, v: number): void {
  const luma = multHi(y, 19077);
  out[at] = clip8(luma + multHi(v, 26149) - 14234);
  out[at + 1] = clip8(luma - multHi(u, 6419) - multHi(v, 13320) + 8708);
  out[at + 2] = clip8(luma + multHi(u, 33050) - 17685);
}

/**
 * Converts one or two rows of luma to RGB, upsampling the chroma between the chroma row above
 * (`topUv`) and the current one (`curUv`) as libwebp's "fancy" upsampler does.
 */
function upsampleRows(
  yPlane: Uint8Array,
  topY: number,
  bottomY: number,
  uPlane: Uint8Array,
  vPlane: Uint8Array,
  topUv: number,
  curUv: number,
  out: Uint8Array,
  topOut: number,
  bottomOut: number,
  width: number,
): void {
  const last = (width - 1) >> 1;
  let tlU = uPlane[topUv] as number;
  let tlV = vPlane[topUv] as number;
  let lU = uPlane[curUv] as number;
  let lV = vPlane[curUv] as number;
  writeRgb(out, topOut, yPlane[topY] as number, (3 * tlU + lU + 2) >> 2, (3 * tlV + lV + 2) >> 2);
  if (bottomY >= 0) {
    writeRgb(
      out,
      bottomOut,
      yPlane[bottomY] as number,
      (3 * lU + tlU + 2) >> 2,
      (3 * lV + tlV + 2) >> 2,
    );
  }
  for (let x = 1; x <= last; x++) {
    const tU = uPlane[topUv + x] as number;
    const tV = vPlane[topUv + x] as number;
    const cU = uPlane[curUv + x] as number;
    const cV = vPlane[curUv + x] as number;
    const avgU = tlU + tU + lU + cU + 8;
    const avgV = tlV + tV + lV + cV + 8;
    const diag12U = (avgU + 2 * (tU + lU)) >> 3;
    const diag12V = (avgV + 2 * (tV + lV)) >> 3;
    const diag03U = (avgU + 2 * (tlU + cU)) >> 3;
    const diag03V = (avgV + 2 * (tlV + cV)) >> 3;
    const left = 2 * x - 1;
    writeRgb(
      out,
      topOut + left * 3,
      yPlane[topY + left] as number,
      (diag12U + tlU) >> 1,
      (diag12V + tlV) >> 1,
    );
    writeRgb(
      out,
      topOut + (left + 1) * 3,
      yPlane[topY + left + 1] as number,
      (diag03U + tU) >> 1,
      (diag03V + tV) >> 1,
    );
    if (bottomY >= 0) {
      writeRgb(
        out,
        bottomOut + left * 3,
        yPlane[bottomY + left] as number,
        (diag03U + lU) >> 1,
        (diag03V + lV) >> 1,
      );
      writeRgb(
        out,
        bottomOut + (left + 1) * 3,
        yPlane[bottomY + left + 1] as number,
        (diag12U + cU) >> 1,
        (diag12V + cV) >> 1,
      );
    }
    tlU = tU;
    tlV = tV;
    lU = cU;
    lV = cV;
  }
  if ((width & 1) === 0) {
    const x = width - 1;
    writeRgb(
      out,
      topOut + x * 3,
      yPlane[topY + x] as number,
      (3 * tlU + lU + 2) >> 2,
      (3 * tlV + lV + 2) >> 2,
    );
    if (bottomY >= 0) {
      writeRgb(
        out,
        bottomOut + x * 3,
        yPlane[bottomY + x] as number,
        (3 * lU + tlU + 2) >> 2,
        (3 * lV + tlV + 2) >> 2,
      );
    }
  }
}

/** Reads a VP8 frame's size from its first ten bytes. */
export function vp8Size(
  data: Uint8Array,
  start: number,
  end: number,
): { width: number; height: number } {
  if (end - start < 10) throw cutShort();
  const bits =
    (data[start] as number) |
    ((data[start + 1] as number) << 8) |
    ((data[start + 2] as number) << 16);
  if (bits & 1) throw new Error("This WebP file holds an animation frame, not a still picture");
  if (((bits >> 1) & 7) > 3) throw corrupt("unknown VP8 profile");
  if (!((bits >> 4) & 1)) throw corrupt("the frame is not meant to be shown");
  if (data[start + 3] !== 0x9d || data[start + 4] !== 0x01 || data[start + 5] !== 0x2a) {
    throw corrupt("the VP8 start code is missing");
  }
  const width = ((data[start + 6] as number) | ((data[start + 7] as number) << 8)) & 0x3fff;
  const height = ((data[start + 8] as number) | ((data[start + 9] as number) << 8)) & 0x3fff;
  if (width === 0 || height === 0) throw corrupt("the picture has no size");
  return { width, height };
}

/** Decodes a VP8 key frame (the payload of a "VP8 " chunk) to RGB, three bytes a pixel. */
export function decodeLossy(
  data: Uint8Array,
  start: number,
  end: number,
): { width: number; height: number; rgb: Uint8Array } {
  const { width, height } = vp8Size(data, start, end);
  const firstSize =
    ((data[start] as number) |
      ((data[start + 1] as number) << 8) |
      ((data[start + 2] as number) << 16)) >>>
    5;
  const firstStart = start + 10;
  if (firstStart + firstSize > end) throw cutShort();
  const header = new BoolDecoder(data, firstStart, firstStart + firstSize);

  header.literal(1); // colour space
  header.literal(1); // clamping type

  // Segments
  const segmentQuant = [0, 0, 0, 0];
  const segmentFilter = [0, 0, 0, 0];
  const segmentProba = [255, 255, 255];
  let segmentAbsolute = false;
  const useSegments = header.literal(1) === 1;
  let updateMap = false;
  if (useSegments) {
    updateMap = header.literal(1) === 1;
    if (header.literal(1)) {
      segmentAbsolute = header.literal(1) === 1;
      for (let s = 0; s < 4; s++) segmentQuant[s] = header.literal(1) ? header.signed(7) : 0;
      for (let s = 0; s < 4; s++) segmentFilter[s] = header.literal(1) ? header.signed(6) : 0;
    }
    if (updateMap)
      for (let s = 0; s < 3; s++) segmentProba[s] = header.literal(1) ? header.literal(8) : 255;
  }

  // Loop filter
  const simple = header.literal(1) === 1;
  const level = header.literal(6);
  const sharpness = header.literal(3);
  const refDelta = [0, 0, 0, 0];
  const modeDelta = [0, 0, 0, 0];
  const useDelta = header.literal(1) === 1;
  if (useDelta && header.literal(1)) {
    for (let i = 0; i < 4; i++) if (header.literal(1)) refDelta[i] = header.signed(6);
    for (let i = 0; i < 4; i++) if (header.literal(1)) modeDelta[i] = header.signed(6);
  }
  const filterType = level === 0 ? 0 : simple ? 1 : 2;

  // Token partitions
  const partitionCount = 1 << header.literal(2);
  const sizesStart = firstStart + firstSize;
  let partStart = sizesStart + 3 * (partitionCount - 1);
  if (partStart > end) throw cutShort();
  const partitions: BoolDecoder[] = [];
  for (let p = 0; p < partitionCount; p++) {
    let partEnd = end;
    if (p < partitionCount - 1) {
      const at = sizesStart + 3 * p;
      const size =
        (data[at] as number) | ((data[at + 1] as number) << 8) | ((data[at + 2] as number) << 16);
      partEnd = Math.min(end, partStart + size);
    }
    partitions.push(new BoolDecoder(data, partStart, partEnd));
    partStart = partEnd;
  }

  // Quantizers
  const base = header.literal(7);
  const deltas: number[] = [];
  for (let i = 0; i < 5; i++) deltas.push(header.literal(1) ? header.signed(4) : 0);
  const [y1Dc, y2Dc, y2Ac, uvDc, uvAc] = deltas as [number, number, number, number, number];
  const clip = (v: number, max: number): number => (v < 0 ? 0 : Math.min(v, max));
  const quantizers: Quantizer[] = [];
  for (let s = 0; s < 4; s++) {
    let q = base;
    if (useSegments) q = (segmentQuant[s] as number) + (segmentAbsolute ? 0 : base);
    else if (s > 0) {
      quantizers.push(quantizers[0] as Quantizer);
      continue;
    }
    const y2AcStep = ((AC_TABLE[clip(q + y2Ac, 127)] as number) * 101581) >> 16;
    quantizers.push({
      y1: [DC_TABLE[clip(q + y1Dc, 127)] as number, AC_TABLE[clip(q, 127)] as number],
      y2: [(DC_TABLE[clip(q + y2Dc, 127)] as number) * 2, Math.max(y2AcStep, 8)],
      uv: [DC_TABLE[clip(q + uvDc, 117)] as number, AC_TABLE[clip(q + uvAc, 127)] as number],
    });
  }

  header.literal(1); // whether the probabilities persist: irrelevant for one frame
  const probas = new Uint8Array(COEFF_PROBA.length);
  for (let i = 0; i < probas.length; i++) {
    probas[i] = header.bit(COEFF_UPDATE_PROBA[i] as number)
      ? header.literal(8)
      : (COEFF_PROBA[i] as number);
  }
  const useSkip = header.literal(1) === 1;
  const skipProba = useSkip ? header.literal(8) : 0;

  // Filter strengths by segment and by whether the macroblock uses 4×4 prediction.
  const strengths: FilterInfo[][] = [];
  for (let s = 0; s < 4; s++) {
    const pair: FilterInfo[] = [];
    for (let i4 = 0; i4 < 2; i4++) {
      let l = useSegments ? (segmentFilter[s] as number) + (segmentAbsolute ? 0 : level) : level;
      if (useDelta) {
        l += refDelta[0] as number;
        if (i4) l += modeDelta[0] as number;
      }
      l = l < 0 ? 0 : Math.min(l, 63);
      if (l === 0) {
        pair.push({ limit: 0, interior: 0, hevThreshold: 0 });
        continue;
      }
      let interior = l;
      if (sharpness > 0) {
        interior >>= sharpness > 4 ? 2 : 1;
        if (interior > 9 - sharpness) interior = 9 - sharpness;
      }
      if (interior < 1) interior = 1;
      pair.push({ limit: 2 * l + interior, interior, hevThreshold: l >= 40 ? 2 : l >= 15 ? 1 : 0 });
    }
    strengths.push(pair);
  }

  const mbWidth = (width + 15) >> 4;
  const mbHeight = (height + 15) >> 4;
  const yStride = mbWidth * 16;
  const uvStride = mbWidth * 8;
  const yPlane = new Uint8Array(yStride * mbHeight * 16);
  const uPlane = new Uint8Array(uvStride * mbHeight * 8);
  const vPlane = new Uint8Array(uvStride * mbHeight * 8);

  // Per-macroblock facts kept for the loop filter.
  const mbFilter: FilterInfo[] = [];
  const mbInner = new Uint8Array(mbWidth * mbHeight);

  // Contexts: modes and non-zero flags of the blocks above and to the left.
  const topModes = new Uint8Array(4 * mbWidth);
  const leftModes = new Uint8Array(4);
  const topNzY = new Uint8Array(4 * mbWidth);
  const topNzU = new Uint8Array(2 * mbWidth);
  const topNzV = new Uint8Array(2 * mbWidth);
  const topNzDc = new Uint8Array(mbWidth);
  const leftNzY = new Uint8Array(4);
  const leftNzU = new Uint8Array(2);
  const leftNzV = new Uint8Array(2);
  let leftNzDc = 0;

  const yBuffer = new Uint8Array(BPS * 17);
  const uBuffer = new Uint8Array(BPS * 9);
  const vBuffer = new Uint8Array(BPS * 9);
  const coefficients = new Int16Array(384);
  const dc = new Int16Array(16);
  const modes = new Uint8Array(16);

  for (let mbY = 0; mbY < mbHeight; mbY++) {
    const tokens = partitions[mbY & (partitionCount - 1)] as BoolDecoder;
    leftModes.fill(DC);
    leftNzY.fill(0);
    leftNzU.fill(0);
    leftNzV.fill(0);
    leftNzDc = 0;
    for (let mbX = 0; mbX < mbWidth; mbX++) {
      // Modes, from the first partition.
      const segment = updateMap
        ? !header.bit(segmentProba[0] as number)
          ? header.bit(segmentProba[1] as number)
          : header.bit(segmentProba[2] as number) + 2
        : 0;
      const skipFlag = useSkip ? header.bit(skipProba) === 1 : false;
      const i4 = !header.bit(145);
      let yMode = DC;
      if (!i4) {
        yMode = header.bit(156) ? (header.bit(128) ? TM : HE) : header.bit(163) ? VE : DC;
        topModes.fill(yMode, 4 * mbX, 4 * mbX + 4);
        leftModes.fill(yMode);
      } else {
        for (let y = 0; y < 4; y++) {
          let mode = leftModes[y] as number;
          for (let x = 0; x < 4; x++) {
            const p = ((topModes[4 * mbX + x] as number) * 10 + mode) * 9;
            let i = BMODE_TREE[header.bit(BMODE_PROBA[p] as number)] as number;
            while (i > 0)
              i = BMODE_TREE[2 * i + header.bit(BMODE_PROBA[p + i] as number)] as number;
            mode = -i;
            topModes[4 * mbX + x] = mode;
            modes[y * 4 + x] = mode;
          }
          leftModes[y] = mode;
        }
      }
      const uvMode = !header.bit(142) ? DC : !header.bit(114) ? VE : header.bit(183) ? TM : HE;
      if (header.exhausted) throw cutShort();

      // Coefficients, from this row's token partition.
      coefficients.fill(0);
      let skip = skipFlag;
      if (!skipFlag) {
        const quant = quantizers[segment] as Quantizer;
        let first = 0;
        let type = 3;
        let anyNonzero = false;
        if (!i4) {
          dc.fill(0);
          const nz = readCoefficients(
            tokens,
            probas,
            1,
            (topNzDc[mbX] as number) + leftNzDc,
            quant.y2,
            0,
            dc,
            0,
          );
          leftNzDc = nz > 0 ? 1 : 0;
          topNzDc[mbX] = leftNzDc;
          if (nz > 1) inverseWht(dc, coefficients);
          else {
            const dc0 = ((dc[0] as number) + 3) >> 3;
            for (let i = 0; i < 256; i += 16) coefficients[i] = dc0;
          }
          first = 1;
          type = 0;
        }
        for (let y = 0; y < 4; y++) {
          for (let x = 0; x < 4; x++) {
            const offset = (y * 4 + x) * 16;
            const context = (leftNzY[y] as number) + (topNzY[4 * mbX + x] as number);
            const nz = readCoefficients(
              tokens,
              probas,
              type,
              context,
              quant.y1,
              first,
              coefficients,
              offset,
            );
            const flag = nz > first ? 1 : 0;
            leftNzY[y] = flag;
            topNzY[4 * mbX + x] = flag;
            if (nz > 1 || coefficients[offset] !== 0) anyNonzero = true;
          }
        }
        for (const [top, left, base] of [
          [topNzU, leftNzU, 256],
          [topNzV, leftNzV, 320],
        ] as const) {
          for (let y = 0; y < 2; y++) {
            for (let x = 0; x < 2; x++) {
              const offset = base + (y * 2 + x) * 16;
              const context = (left[y] as number) + (top[2 * mbX + x] as number);
              const nz = readCoefficients(
                tokens,
                probas,
                2,
                context,
                quant.uv,
                0,
                coefficients,
                offset,
              );
              const flag = nz > 0 ? 1 : 0;
              left[y] = flag;
              top[2 * mbX + x] = flag;
              if (nz > 1 || coefficients[offset] !== 0) anyNonzero = true;
            }
          }
        }
        skip = !anyNonzero;
      } else {
        leftNzY.fill(0);
        leftNzU.fill(0);
        leftNzV.fill(0);
        topNzY.fill(0, 4 * mbX, 4 * mbX + 4);
        topNzU.fill(0, 2 * mbX, 2 * mbX + 2);
        topNzV.fill(0, 2 * mbX, 2 * mbX + 2);
        if (!i4) {
          leftNzDc = 0;
          topNzDc[mbX] = 0;
        }
      }
      if (tokens.exhausted) throw cutShort();
      mbFilter.push((strengths[segment] as FilterInfo[])[i4 ? 1 : 0] as FilterInfo);
      mbInner[mbY * mbWidth + mbX] = i4 || !skip ? 1 : 0;

      // Reconstruction: prediction from the unfiltered neighbours, plus the residual.
      const yAt = mbY * 16 * yStride + mbX * 16;
      const uvAt = mbY * 8 * uvStride + mbX * 8;
      loadEdges(yBuffer, yPlane, 16, yStride, yAt, mbX, mbY);
      loadEdges(uBuffer, uPlane, 8, uvStride, uvAt, mbX, mbY);
      loadEdges(vBuffer, vPlane, 8, uvStride, uvAt, mbX, mbY);
      if (i4) {
        // The four samples above and to the right, used by the right column of blocks.
        const topRight = Y_OFFSET - BPS + 16;
        for (let x = 0; x < 4; x++) {
          const value =
            mbY === 0 ? 127 : (yPlane[yAt - yStride + (mbX < mbWidth - 1 ? 16 + x : 15)] as number);
          for (let row = 0; row < 16; row += 4) yBuffer[topRight + row * BPS + x] = value;
        }
        for (let n = 0; n < 16; n++) {
          const at = Y_OFFSET + (n & 3) * 4 + (n >> 2) * 4 * BPS;
          predict4(yBuffer, at, modes[n] as number);
          addTransform(coefficients, n * 16, yBuffer, at);
        }
      } else {
        predictBlock(yBuffer, Y_OFFSET, 16, edgeMode(yMode, mbX, mbY));
        for (let n = 0; n < 16; n++) {
          addTransform(coefficients, n * 16, yBuffer, Y_OFFSET + (n & 3) * 4 + (n >> 2) * 4 * BPS);
        }
      }
      const chromaMode = edgeMode(uvMode, mbX, mbY);
      predictBlock(uBuffer, UV_OFFSET, 8, chromaMode);
      predictBlock(vBuffer, UV_OFFSET, 8, chromaMode);
      for (let n = 0; n < 4; n++) {
        const at = UV_OFFSET + (n & 1) * 4 + (n >> 1) * 4 * BPS;
        addTransform(coefficients, 256 + n * 16, uBuffer, at);
        addTransform(coefficients, 320 + n * 16, vBuffer, at);
      }
      storeBlock(yBuffer, yPlane, 16, yStride, yAt);
      storeBlock(uBuffer, uPlane, 8, uvStride, uvAt);
      storeBlock(vBuffer, vPlane, 8, uvStride, uvAt);
    }
  }

  // Loop filter, macroblock by macroblock in decoding order.
  if (filterType > 0) {
    for (let mbY = 0; mbY < mbHeight; mbY++) {
      for (let mbX = 0; mbX < mbWidth; mbX++) {
        const index = mbY * mbWidth + mbX;
        const { limit, interior, hevThreshold } = mbFilter[index] as FilterInfo;
        if (limit === 0) continue;
        const inner = mbInner[index] === 1;
        const yAt = mbY * 16 * yStride + mbX * 16;
        if (filterType === 1) {
          if (mbX > 0) simpleEdge(yPlane, yAt, 1, yStride, limit + 4);
          if (inner) for (const x of [4, 8, 12]) simpleEdge(yPlane, yAt + x, 1, yStride, limit);
          if (mbY > 0) simpleEdge(yPlane, yAt, yStride, 1, limit + 4);
          if (inner)
            for (const y of [4, 8, 12]) simpleEdge(yPlane, yAt + y * yStride, yStride, 1, limit);
          continue;
        }
        const uvAt = mbY * 8 * uvStride + mbX * 8;
        const h = hevThreshold;
        if (mbX > 0) {
          normalEdge(yPlane, yAt, 1, yStride, 16, limit + 4, interior, h, true);
          normalEdge(uPlane, uvAt, 1, uvStride, 8, limit + 4, interior, h, true);
          normalEdge(vPlane, uvAt, 1, uvStride, 8, limit + 4, interior, h, true);
        }
        if (inner) {
          for (const x of [4, 8, 12])
            normalEdge(yPlane, yAt + x, 1, yStride, 16, limit, interior, h, false);
          normalEdge(uPlane, uvAt + 4, 1, uvStride, 8, limit, interior, h, false);
          normalEdge(vPlane, uvAt + 4, 1, uvStride, 8, limit, interior, h, false);
        }
        if (mbY > 0) {
          normalEdge(yPlane, yAt, yStride, 1, 16, limit + 4, interior, h, true);
          normalEdge(uPlane, uvAt, uvStride, 1, 8, limit + 4, interior, h, true);
          normalEdge(vPlane, uvAt, uvStride, 1, 8, limit + 4, interior, h, true);
        }
        if (inner) {
          for (const y of [4, 8, 12]) {
            normalEdge(yPlane, yAt + y * yStride, yStride, 1, 16, limit, interior, h, false);
          }
          normalEdge(uPlane, uvAt + 4 * uvStride, uvStride, 1, 8, limit, interior, h, false);
          normalEdge(vPlane, uvAt + 4 * uvStride, uvStride, 1, 8, limit, interior, h, false);
        }
      }
    }
  }

  // RGB with the chroma upsampled between rows: row 0 alone, then pairs, then the last row of
  // an even height alone.
  const rgb = new Uint8Array(width * height * 3);
  const rowBytes = width * 3;
  upsampleRows(yPlane, 0, -1, uPlane, vPlane, 0, 0, rgb, 0, -1, width);
  let y = 0;
  for (; y + 2 < height; y += 2) {
    const uv = (y >> 1) * uvStride;
    upsampleRows(
      yPlane,
      (y + 1) * yStride,
      (y + 2) * yStride,
      uPlane,
      vPlane,
      uv,
      uv + uvStride,
      rgb,
      (y + 1) * rowBytes,
      (y + 2) * rowBytes,
      width,
    );
  }
  if ((height & 1) === 0) {
    const uv = (y >> 1) * uvStride;
    upsampleRows(
      yPlane,
      (y + 1) * yStride,
      -1,
      uPlane,
      vPlane,
      uv,
      uv,
      rgb,
      (y + 1) * rowBytes,
      -1,
      width,
    );
  }
  return { width, height, rgb };
}

/** The DC mode to use when the macroblock sits on the top or left edge of the picture. */
function edgeMode(mode: number, mbX: number, mbY: number): number {
  if (mode !== DC) return mode;
  if (mbX === 0) return mbY === 0 ? DC_NO_TOP_LEFT : DC_NO_LEFT;
  return mbY === 0 ? DC_NO_TOP : DC;
}
