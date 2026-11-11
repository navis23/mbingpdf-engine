/**
 * The lossless WebP format (VP8L, RFC 9649 section 3): an image of ARGB pixels coded with
 * prefix codes, backward references and a colour cache, after up to four reversible
 * transforms. Also used for the alpha plane of lossy images.
 */
import { CODE_TO_PLANE } from "./tables.ts";

const cutShort = (): Error => new Error("The WebP image data is cut short");
const corrupt = (what: string): Error => new Error(`The WebP image data is damaged: ${what}`);

/** Reads bits least significant first. */
class BitReader {
  private value = 0;
  private count = 0;
  private position: number;
  private consumed = 0;
  private readonly available: number;
  private readonly data: Uint8Array;
  private readonly end: number;

  constructor(data: Uint8Array, start: number, end: number) {
    this.data = data;
    this.end = end;
    this.position = start;
    this.available = (end - start) * 8;
  }

  /** Fills the window to at least 25 bits; past the end it is filled with zeros. */
  private fill(): void {
    while (this.count <= 24) {
      if (this.position < this.end)
        this.value |= (this.data[this.position] as number) << this.count;
      this.position++;
      this.count += 8;
    }
  }

  /** The next 15 bits, without consuming them. */
  peek(): number {
    if (this.count < 15) this.fill();
    return this.value & 0x7fff;
  }

  skip(bits: number): void {
    this.value >>>= bits;
    this.count -= bits;
    this.consumed += bits;
    if (this.consumed > this.available) throw cutShort();
  }

  read(bits: number): number {
    if (bits === 0) return 0;
    if (this.count < bits) this.fill();
    const result = this.value & ((1 << bits) - 1);
    this.skip(bits);
    return result;
  }
}

// A prefix code is a lookup table: an 8-bit root, and second-level tables for longer codes.
// An entry is (length << 16) | symbol; a root entry that links to a second-level table is
// ((LINK + bits of that table) << 16) | its offset.
const ROOT_BITS = 8;
const LINK = 0x40;

/** Builds the decoding table of a canonical prefix code from its code lengths. */
function buildCode(lengths: Uint8Array): Int32Array {
  const counts = new Int32Array(16);
  let used = 0;
  let only = 0;
  for (let symbol = 0; symbol < lengths.length; symbol++) {
    const length = lengths[symbol] as number;
    if (length === 0) continue;
    counts[length] = (counts[length] as number) + 1;
    used++;
    only = symbol;
  }
  if (used === 0) throw corrupt("a prefix code has no symbols");
  // A code of one symbol takes no bits to read.
  if (used === 1) return new Int32Array(1 << ROOT_BITS).fill(only);

  // The code must be complete: neither over- nor under-subscribed.
  let left = 1;
  for (let length = 1; length < 16; length++) {
    left = 2 * left - (counts[length] as number);
    if (left < 0) throw corrupt("a prefix code is over-subscribed");
  }
  if (left !== 0) throw corrupt("a prefix code is incomplete");

  // Canonical codes, first code of each length.
  const next = new Int32Array(16);
  for (let length = 1, code = 0; length < 16; length++) {
    code = (code + (counts[length - 1] as number)) << 1;
    next[length] = code;
  }
  // Codes are read least significant bit first, so each one is stored reversed.
  const codes = new Int32Array(lengths.length);
  for (let symbol = 0; symbol < lengths.length; symbol++) {
    const length = lengths[symbol] as number;
    if (length === 0) continue;
    const code = next[length] as number;
    next[length] = code + 1;
    let reversed = 0;
    for (let bit = 0; bit < length; bit++) reversed |= ((code >> bit) & 1) << (length - 1 - bit);
    codes[symbol] = reversed;
  }

  // The size of each second-level table: enough bits for the longest code behind that prefix.
  const subBits = new Int32Array(1 << ROOT_BITS);
  for (let symbol = 0; symbol < lengths.length; symbol++) {
    const length = lengths[symbol] as number;
    if (length <= ROOT_BITS) continue;
    const prefix = (codes[symbol] as number) & ((1 << ROOT_BITS) - 1);
    subBits[prefix] = Math.max(subBits[prefix] as number, length - ROOT_BITS);
  }
  let size = 1 << ROOT_BITS;
  const offsets = new Int32Array(1 << ROOT_BITS);
  for (let prefix = 0; prefix < 1 << ROOT_BITS; prefix++) {
    const bits = subBits[prefix] as number;
    if (bits === 0) continue;
    offsets[prefix] = size;
    size += 1 << bits;
  }
  const table = new Int32Array(size);
  for (let prefix = 0; prefix < 1 << ROOT_BITS; prefix++) {
    const bits = subBits[prefix] as number;
    if (bits > 0) table[prefix] = ((LINK + bits) << 16) | (offsets[prefix] as number);
  }
  for (let symbol = 0; symbol < lengths.length; symbol++) {
    const length = lengths[symbol] as number;
    if (length === 0) continue;
    const code = codes[symbol] as number;
    if (length <= ROOT_BITS) {
      for (let at = code; at < 1 << ROOT_BITS; at += 1 << length)
        table[at] = (length << 16) | symbol;
    } else {
      const prefix = code & ((1 << ROOT_BITS) - 1);
      const bits = subBits[prefix] as number;
      const rest = length - ROOT_BITS;
      const base = offsets[prefix] as number;
      for (let at = code >> ROOT_BITS; at < 1 << bits; at += 1 << rest) {
        table[base + at] = (rest << 16) | symbol;
      }
    }
  }
  return table;
}

function readSymbol(table: Int32Array, reader: BitReader): number {
  const bits = reader.peek();
  let entry = table[bits & ((1 << ROOT_BITS) - 1)] as number;
  let length = entry >>> 16;
  if (length >= LINK) {
    reader.skip(ROOT_BITS);
    const sub = length - LINK;
    entry = table[(entry & 0xffff) + ((bits >>> ROOT_BITS) & ((1 << sub) - 1))] as number;
    length = entry >>> 16;
  }
  reader.skip(length);
  return entry & 0xffff;
}

/** The order in which the lengths of the code-length code are stored. */
const CODE_LENGTH_ORDER = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

/** Reads one prefix code over an alphabet of `size` symbols. */
function readCode(reader: BitReader, size: number): Int32Array {
  const lengths = new Uint8Array(size);
  if (reader.read(1)) {
    // A simple code: one or two symbols.
    const symbols = reader.read(1) + 1;
    const first = reader.read(reader.read(1) === 0 ? 1 : 8);
    if (first >= size) throw corrupt("a symbol is outside its alphabet");
    lengths[first] = 1;
    if (symbols === 2) {
      const second = reader.read(8);
      if (second >= size) throw corrupt("a symbol is outside its alphabet");
      lengths[second] = 1;
    }
    return buildCode(lengths);
  }

  const lengthLengths = new Uint8Array(19);
  const stored = reader.read(4) + 4;
  for (let i = 0; i < stored; i++) lengthLengths[CODE_LENGTH_ORDER[i] as number] = reader.read(3);
  const lengthCode = buildCode(lengthLengths);

  let limit = size;
  if (reader.read(1)) {
    const bits = 2 + 2 * reader.read(3);
    limit = 2 + reader.read(bits);
    if (limit > size) throw corrupt("too many code lengths");
  }
  let previous = 8;
  let symbol = 0;
  while (symbol < size) {
    if (limit-- === 0) break;
    const length = readSymbol(lengthCode, reader);
    if (length < 16) {
      lengths[symbol++] = length;
      if (length !== 0) previous = length;
      continue;
    }
    const slot = length - 16;
    const repeat = reader.read([2, 3, 7][slot] as number) + ([3, 3, 11][slot] as number);
    if (symbol + repeat > size) throw corrupt("code lengths run past the alphabet");
    lengths.fill(length === 16 ? previous : 0, symbol, symbol + repeat);
    symbol += repeat;
  }
  return buildCode(lengths);
}

const subSize = (size: number, bits: number): number => (size + (1 << bits) - 1) >> bits;

/** A length or distance from its prefix symbol and extra bits. */
function copyValue(symbol: number, reader: BitReader): number {
  if (symbol < 4) return symbol + 1;
  const extra = (symbol - 2) >> 1;
  return ((2 + (symbol & 1)) << extra) + reader.read(extra) + 1;
}

interface Group {
  readonly green: Int32Array;
  readonly red: Int32Array;
  readonly blue: Int32Array;
  readonly alpha: Int32Array;
  readonly distance: Int32Array;
}

/**
 * Decodes a coded image of `width` × `height` pixels. Only the main image (`main`) may use a
 * meta prefix image that switches codes by region.
 */
function decodeCoded(reader: BitReader, width: number, height: number, main: boolean): Int32Array {
  let cacheBits = 0;
  if (reader.read(1)) {
    cacheBits = reader.read(4);
    if (cacheBits < 1 || cacheBits > 11) throw corrupt("bad colour cache size");
  }
  const cacheSize = cacheBits > 0 ? 1 << cacheBits : 0;

  let metaBits = 0;
  let metaWidth = 0;
  let meta: Int32Array | undefined;
  let groupCount = 1;
  if (main && reader.read(1)) {
    metaBits = reader.read(3) + 2;
    metaWidth = subSize(width, metaBits);
    const image = decodeCoded(reader, metaWidth, subSize(height, metaBits), false);
    meta = new Int32Array(image.length);
    for (let i = 0; i < image.length; i++) {
      const group = ((image[i] as number) >> 8) & 0xffff;
      meta[i] = group;
      if (group >= groupCount) groupCount = group + 1;
    }
  }

  // Five codes per group: green (with lengths and cache indices), red, blue, alpha, distance.
  const groups: Group[] = [];
  for (let g = 0; g < groupCount; g++) {
    groups.push({
      green: readCode(reader, 256 + 24 + cacheSize),
      red: readCode(reader, 256),
      blue: readCode(reader, 256),
      alpha: readCode(reader, 256),
      distance: readCode(reader, 40),
    });
  }
  const groupAt = (x: number, y: number): Group =>
    groups[meta ? (meta[(y >> metaBits) * metaWidth + (x >> metaBits)] as number) : 0] as Group;

  const cache = new Int32Array(cacheSize);
  const shift = 32 - cacheBits;
  const total = width * height;
  const pixels = new Int32Array(total);
  const mask = meta ? (1 << metaBits) - 1 : -1;
  let group = groupAt(0, 0);
  let x = 0;
  let y = 0;
  let at = 0;
  // Pixels before this one are in the colour cache; the rest are added before it is read.
  let cached = 0;
  while (at < total) {
    if ((x & mask) === 0) group = groupAt(x, y);
    const code = readSymbol(group.green, reader);
    if (code < 256) {
      const r = readSymbol(group.red, reader);
      const b = readSymbol(group.blue, reader);
      const a = readSymbol(group.alpha, reader);
      pixels[at++] = (a << 24) | (r << 16) | (code << 8) | b;
      if (++x === width) {
        x = 0;
        y++;
      }
    } else if (code < 256 + 24) {
      const length = copyValue(code - 256, reader);
      const planeCode = copyValue(readSymbol(group.distance, reader), reader);
      let back: number;
      if (planeCode > 120) back = planeCode - 120;
      else {
        const offset = CODE_TO_PLANE[planeCode - 1] as number;
        back = Math.max(1, (offset >> 4) * width + (8 - (offset & 0xf)));
      }
      if (back > at || at + length > total) throw corrupt("a backward reference is out of range");
      for (let i = 0; i < length; i++, at++) pixels[at] = pixels[at - back] as number;
      x += length;
      while (x >= width) {
        x -= width;
        y++;
      }
      if (at < total) group = groupAt(x, y);
    } else {
      for (; cached < at; cached++) {
        const pixel = pixels[cached] as number;
        cache[Math.imul(pixel, 0x1e35a7bd) >>> shift] = pixel;
      }
      pixels[at++] = cache[code - 280] as number;
      if (++x === width) {
        x = 0;
        y++;
      }
    }
  }
  return pixels;
}

// Pixels are packed ARGB in 32-bit signed integers, so that all arithmetic stays in integers.
const BLACK = 0xff000000 | 0;

/** Adds two pixels channel by channel, modulo 256. */
const add = (a: number, b: number): number =>
  (((((a >>> 8) & 0x00ff00ff) + ((b >>> 8) & 0x00ff00ff)) & 0x00ff00ff) << 8) |
  (((a & 0x00ff00ff) + (b & 0x00ff00ff)) & 0x00ff00ff);
/** The average of two pixels channel by channel, rounded down. */
const average = (a: number, b: number): number => ((((a ^ b) & 0xfefefefe) >>> 1) + (a & b)) | 0;
const clamp = (v: number): number => (v < 0 ? 0 : Math.min(v, 255));

function select(top: number, left: number, topLeft: number): number {
  let difference = 0;
  for (let s = 0; s < 32; s += 8) {
    const t = (top >>> s) & 0xff;
    const l = (left >>> s) & 0xff;
    const c = (topLeft >>> s) & 0xff;
    difference += Math.abs(l - c) - Math.abs(t - c);
  }
  return difference <= 0 ? top : left;
}

function addSubtractFull(a: number, b: number, c: number): number {
  let out = 0;
  for (let s = 0; s < 32; s += 8) {
    out |= clamp(((a >>> s) & 0xff) + ((b >>> s) & 0xff) - ((c >>> s) & 0xff)) << s;
  }
  return out;
}

function addSubtractHalf(a: number, b: number): number {
  let out = 0;
  for (let s = 0; s < 32; s += 8) {
    const x = (a >>> s) & 0xff;
    out |= clamp(x + Math.trunc((x - ((b >>> s) & 0xff)) / 2)) << s;
  }
  return out;
}

/**
 * Adds the prediction of `mode` (0–13; 14 and 15 predict black) to the pixels from `from` to
 * `to` on one row, each predicted from neighbours already decoded.
 */
function predictSpan(p: Int32Array, from: number, to: number, width: number, mode: number): void {
  const up = from - width;
  switch (mode) {
    case 1:
      for (let at = from; at < to; at++) p[at] = add(p[at] as number, p[at - 1] as number);
      return;
    case 2:
      for (let at = from, t = up; at < to; at++, t++) p[at] = add(p[at] as number, p[t] as number);
      return;
    case 3:
      for (let at = from, t = up; at < to; at++, t++)
        p[at] = add(p[at] as number, p[t + 1] as number);
      return;
    case 4:
      for (let at = from, t = up; at < to; at++, t++)
        p[at] = add(p[at] as number, p[t - 1] as number);
      return;
    case 5:
      for (let at = from, t = up; at < to; at++, t++) {
        const prediction = average(
          average(p[at - 1] as number, p[t + 1] as number),
          p[t] as number,
        );
        p[at] = add(p[at] as number, prediction);
      }
      return;
    case 6:
      for (let at = from, t = up; at < to; at++, t++) {
        p[at] = add(p[at] as number, average(p[at - 1] as number, p[t - 1] as number));
      }
      return;
    case 7:
      for (let at = from, t = up; at < to; at++, t++) {
        p[at] = add(p[at] as number, average(p[at - 1] as number, p[t] as number));
      }
      return;
    case 8:
      for (let at = from, t = up; at < to; at++, t++) {
        p[at] = add(p[at] as number, average(p[t - 1] as number, p[t] as number));
      }
      return;
    case 9:
      for (let at = from, t = up; at < to; at++, t++) {
        p[at] = add(p[at] as number, average(p[t] as number, p[t + 1] as number));
      }
      return;
    case 10:
      for (let at = from, t = up; at < to; at++, t++) {
        const prediction = average(
          average(p[at - 1] as number, p[t - 1] as number),
          average(p[t] as number, p[t + 1] as number),
        );
        p[at] = add(p[at] as number, prediction);
      }
      return;
    case 11:
      for (let at = from, t = up; at < to; at++, t++) {
        const prediction = select(p[t] as number, p[at - 1] as number, p[t - 1] as number);
        p[at] = add(p[at] as number, prediction);
      }
      return;
    case 12:
      for (let at = from, t = up; at < to; at++, t++) {
        const prediction = addSubtractFull(p[at - 1] as number, p[t] as number, p[t - 1] as number);
        p[at] = add(p[at] as number, prediction);
      }
      return;
    case 13:
      for (let at = from, t = up; at < to; at++, t++) {
        const prediction = addSubtractHalf(
          average(p[at - 1] as number, p[t] as number),
          p[t - 1] as number,
        );
        p[at] = add(p[at] as number, prediction);
      }
      return;
    default:
      for (let at = from; at < to; at++) p[at] = add(p[at] as number, BLACK);
  }
}

function inversePredictor(
  pixels: Int32Array,
  width: number,
  height: number,
  bits: number,
  modes: Int32Array,
): void {
  const tiles = subSize(width, bits);
  // The first row predicts from the left, the first pixel from black; the first column from
  // the pixel above.
  pixels[0] = add(pixels[0] as number, BLACK);
  predictSpan(pixels, 1, width, width, 1);
  for (let y = 1; y < height; y++) {
    const row = y * width;
    pixels[row] = add(pixels[row] as number, pixels[row - width] as number);
    const tileRow = (y >> bits) * tiles;
    for (let x = 1; x < width; ) {
      const tile = x >> bits;
      const end = Math.min(width, (tile + 1) << bits);
      const mode = ((modes[tileRow + tile] as number) >> 8) & 0xf;
      predictSpan(pixels, row + x, row + end, width, mode);
      x = end;
    }
  }
}

/** The signed product of two 8-bit values, scaled down by 32. */
const delta = (multiplier: number, value: number): number =>
  (((multiplier << 24) >> 24) * ((value << 24) >> 24)) >> 5;

function inverseCrossColor(
  pixels: Int32Array,
  width: number,
  height: number,
  bits: number,
  data: Int32Array,
): void {
  const tiles = subSize(width, bits);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const element = data[(y >> bits) * tiles + (x >> bits)] as number;
      const at = y * width + x;
      const argb = pixels[at] as number;
      const green = (argb >> 8) & 0xff;
      const red = (((argb >> 16) & 0xff) + delta(element & 0xff, green)) & 0xff;
      const blue =
        ((argb & 0xff) + delta((element >> 8) & 0xff, green) + delta((element >> 16) & 0xff, red)) &
        0xff;
      pixels[at] = (argb & 0xff00ff00) | (red << 16) | blue;
    }
  }
}

function inverseSubtractGreen(pixels: Int32Array): void {
  for (let i = 0; i < pixels.length; i++) {
    const argb = pixels[i] as number;
    const green = (argb >> 8) & 0xff;
    const redBlue = ((argb & 0x00ff00ff) + ((green << 16) | green)) & 0x00ff00ff;
    pixels[i] = (argb & 0xff00ff00) | redBlue;
  }
}

function inverseColorIndexing(
  packed: Int32Array,
  width: number,
  height: number,
  bits: number,
  palette: Int32Array,
): Int32Array {
  if (bits === 0) {
    for (let i = 0; i < packed.length; i++)
      packed[i] = palette[((packed[i] as number) >> 8) & 0xff] as number;
    return packed;
  }
  const out = new Int32Array(width * height);
  const packedWidth = subSize(width, bits);
  const perPixel = 8 >> bits;
  const mask = (1 << perPixel) - 1;
  const count = (1 << bits) - 1;
  for (let y = 0; y < height; y++) {
    let indices = 0;
    for (let x = 0; x < width; x++) {
      if ((x & count) === 0)
        indices = ((packed[y * packedWidth + (x >> bits)] as number) >> 8) & 0xff;
      out[y * width + x] = palette[indices & mask] as number;
      indices >>= perPixel;
    }
  }
  return out;
}

type Transform =
  | { kind: 0; width: number; bits: number; data: Int32Array }
  | { kind: 1; width: number; bits: number; data: Int32Array }
  | { kind: 2; width: number }
  | { kind: 3; width: number; bits: number; palette: Int32Array };

/**
 * Decodes a VP8L image stream without its header: the transforms, then the coded image. The
 * result is one ARGB pixel per element, row by row.
 */
export function decodeLosslessStream(
  data: Uint8Array,
  start: number,
  end: number,
  width: number,
  height: number,
): Int32Array {
  const reader = new BitReader(data, start, end);
  return decodeStream(reader, width, height);
}

function decodeStream(reader: BitReader, width: number, height: number): Int32Array {
  const transforms: Transform[] = [];
  const seen = new Set<number>();
  let codedWidth = width;
  while (reader.read(1)) {
    const kind = reader.read(2);
    if (seen.has(kind)) throw corrupt("a transform is used twice");
    seen.add(kind);
    if (kind === 0 || kind === 1) {
      const bits = reader.read(3) + 2;
      const data = decodeCoded(reader, subSize(codedWidth, bits), subSize(height, bits), false);
      transforms.push({ kind, width: codedWidth, bits, data });
    } else if (kind === 2) {
      transforms.push({ kind, width: codedWidth });
    } else {
      const colors = reader.read(8) + 1;
      const bits = colors > 16 ? 0 : colors > 4 ? 1 : colors > 2 ? 2 : 3;
      const stored = decodeCoded(reader, colors, 1, false);
      // Entries are stored as differences from the one before; indices past the end are
      // transparent black.
      const palette = new Int32Array(1 << (8 >> bits));
      palette[0] = stored[0] as number;
      for (let i = 1; i < colors; i++)
        palette[i] = add(stored[i] as number, palette[i - 1] as number);
      transforms.push({ kind: 3, width: codedWidth, bits, palette });
      codedWidth = subSize(codedWidth, bits);
    }
  }

  let pixels = decodeCoded(reader, codedWidth, height, true);
  for (let i = transforms.length - 1; i >= 0; i--) {
    const transform = transforms[i] as Transform;
    if (transform.kind === 0) {
      inversePredictor(pixels, transform.width, height, transform.bits, transform.data);
    } else if (transform.kind === 1) {
      inverseCrossColor(pixels, transform.width, height, transform.bits, transform.data);
    } else if (transform.kind === 2) {
      inverseSubtractGreen(pixels);
    } else {
      pixels = inverseColorIndexing(
        pixels,
        transform.width,
        height,
        transform.bits,
        transform.palette,
      );
    }
  }
  return pixels;
}

/** Decodes a complete VP8L bitstream (the payload of a "VP8L" chunk). */
export function decodeLossless(
  data: Uint8Array,
  start: number,
  end: number,
): { width: number; height: number; pixels: Int32Array } {
  if (data[start] !== 0x2f) throw corrupt("the lossless signature is missing");
  const reader = new BitReader(data, start + 1, end);
  const width = reader.read(14) + 1;
  const height = reader.read(14) + 1;
  reader.read(1); // whether alpha is used: a hint only
  if (reader.read(3) !== 0) throw new Error("This WebP lossless version is not supported");
  return { width, height, pixels: decodeStream(reader, width, height) };
}
