/**
 * `mbingpdf/qr` — QR code generation (ISO/IEC 18004), as a grid of dark and light modules.
 * The document API draws it as vector shapes, so a code stays sharp at any print size.
 */

/** Error correction: how much of the code may be damaged and still read (about 7, 15, 25, 30%). */
export type QrLevel = "L" | "M" | "Q" | "H";

export interface QrOptions {
  /** Default `"M"`. Use `"H"` for codes that may get dirty or creased. */
  level?: QrLevel;
  /** Smallest version (size) to use, 1–40. The encoder goes larger when the data needs it. */
  minVersion?: number;
}

export interface QrMatrix {
  /** Number of modules along each side: 21 for version 1, up to 177 for version 40. */
  readonly size: number;
  /** 1–40. */
  readonly version: number;
  /** Row by row; true is a dark module. */
  readonly modules: readonly (readonly boolean[])[];
}

const LEVELS: Record<QrLevel, { index: number; format: number }> = {
  L: { index: 0, format: 1 },
  M: { index: 1, format: 0 },
  Q: { index: 2, format: 3 },
  H: { index: 3, format: 2 },
};

// Error-correction codewords per block, by level and version (index 0 is unused).
// biome-ignore format: tables from the standard
const ECC_PER_BLOCK: readonly (readonly number[])[] = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
// Number of error-correction blocks, by level and version.
// biome-ignore format: tables from the standard
const BLOCKS: readonly (readonly number[])[] = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

/** Number of modules available for data and error correction in a version. */
function rawModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const alignments = Math.floor(version / 7) + 2;
    result -= (25 * alignments - 10) * alignments - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function dataCodewords(version: number, level: number): number {
  return (
    Math.floor(rawModules(version) / 8) -
    (ECC_PER_BLOCK[level]?.[version] as number) * (BLOCKS[level]?.[version] as number)
  );
}

/** Multiplies two elements of GF(2^8) modulo the QR polynomial 0x11D. */
function multiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

/** The Reed–Solomon generator polynomial of a degree, highest term dropped. */
function generator(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = multiply(result[j] as number, root);
      if (j + 1 < degree) result[j] = (result[j] as number) ^ (result[j + 1] as number);
    }
    root = multiply(root, 0x02);
  }
  return result;
}

function remainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coefficient, i) => {
      result[i] = (result[i] as number) ^ multiply(coefficient, factor);
    });
  }
  return result;
}

/** Splits data into blocks, adds error correction to each, and interleaves them. */
function addErrorCorrection(data: number[], version: number, level: number): number[] {
  const blocks = BLOCKS[level]?.[version] as number;
  const eccLength = ECC_PER_BLOCK[level]?.[version] as number;
  const total = Math.floor(rawModules(version) / 8);
  const shortBlocks = blocks - (total % blocks);
  const shortLength = Math.floor(total / blocks);
  const divisor = generator(eccLength);
  const parts: number[][] = [];
  let offset = 0;
  for (let i = 0; i < blocks; i++) {
    const length = shortLength - eccLength + (i < shortBlocks ? 0 : 1);
    const block = data.slice(offset, offset + length);
    offset += length;
    const ecc = remainder(block, divisor);
    if (i < shortBlocks) block.push(0);
    parts.push(block.concat(ecc));
  }
  const result: number[] = [];
  for (let i = 0; i < (parts[0] as number[]).length; i++) {
    parts.forEach((block, j) => {
      // Skip the padding byte that short blocks carry.
      if (i !== shortLength - eccLength || j >= shortBlocks) result.push(block[i] as number);
    });
  }
  return result;
}

function alignmentPositions(version: number, size: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let position = size - 7; result.length < count; position -= step)
    result.splice(1, 0, position);
  return result;
}

const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** Scores a finished code: lower is easier for scanners to read. */
function penalty(modules: boolean[][], size: number): number {
  let result = 0;
  const line = (get: (i: number) => boolean): void => {
    // Runs of five or more of one colour.
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && get(i) === get(i - 1)) run++;
      else {
        if (run >= 5) result += run - 2;
        run = 1;
      }
    }
    // Sequences that look like a finder pattern (1:1:3:1:1 with four light modules beside).
    for (let i = 0; i + 11 <= size; i++) {
      let bits = 0;
      for (let k = 0; k < 11; k++) bits = (bits << 1) | (get(i + k) ? 1 : 0);
      if (bits === 0b10111010000 || bits === 0b00001011101) result += 40;
    }
  };
  for (let y = 0; y < size; y++) line((x) => (modules[y] as boolean[])[x] as boolean);
  for (let x = 0; x < size; x++) line((y) => (modules[y] as boolean[])[x] as boolean);
  // Two-by-two blocks of one colour.
  for (let y = 0; y + 1 < size; y++) {
    for (let x = 0; x + 1 < size; x++) {
      const colour = modules[y]?.[x];
      if (
        colour === modules[y]?.[x + 1] &&
        colour === modules[y + 1]?.[x] &&
        colour === modules[y + 1]?.[x + 1]
      ) {
        result += 3;
      }
    }
  }
  // Imbalance between dark and light.
  let dark = 0;
  for (const row of modules) for (const module of row) if (module) dark++;
  const total = size * size;
  result += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return result;
}

/**
 * Encodes text as a QR code. Text is stored as UTF-8 bytes, which every scanner reads.
 * Throws when the text is too long for the largest code at the chosen level.
 */
export function qrCode(text: string, options: QrOptions = {}): QrMatrix {
  const level = LEVELS[options.level ?? "M"];
  if (!level) throw new RangeError(`Unknown QR error-correction level "${options.level}"`);
  const bytes = new TextEncoder().encode(text);

  // The smallest version that holds the data: a 4-bit mode, the length, then the bytes.
  let version = Math.max(1, Math.min(40, Math.floor(options.minVersion ?? 1)));
  for (; ; version++) {
    if (version > 40)
      throw new RangeError("The text is too long for a QR code at this error-correction level");
    const lengthBits = version < 10 ? 8 : 16;
    if (4 + lengthBits + bytes.length * 8 <= dataCodewords(version, level.index) * 8) break;
  }
  const capacity = dataCodewords(version, level.index) * 8;
  const bits: number[] = [];
  const append = (value: number, length: number): void => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  append(0b0100, 4);
  append(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) append(byte, 8);
  append(0, Math.min(4, capacity - bits.length));
  append(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) append(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let k = 0; k < 8; k++) byte = (byte << 1) | (bits[i + k] as number);
    data.push(byte);
  }
  const codewords = addErrorCorrection(data, version, level.index);

  const size = version * 4 + 17;
  const modules: boolean[][] = Array.from({ length: size }, () =>
    new Array<boolean>(size).fill(false),
  );
  const reserved: boolean[][] = Array.from({ length: size }, () =>
    new Array<boolean>(size).fill(false),
  );
  const set = (x: number, y: number, dark: boolean): void => {
    (modules[y] as boolean[])[x] = dark;
    (reserved[y] as boolean[])[x] = true;
  };

  // Timing patterns, finder patterns with their separators, alignment patterns.
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  const finder = (cx: number, cy: number): void => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, distance !== 2 && distance !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const alignments = alignmentPositions(version, size);
  alignments.forEach((cx, i) => {
    alignments.forEach((cy, j) => {
      // Not where the finder patterns are.
      const last = alignments.length - 1;
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++)
          set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    });
  });

  const drawFormat = (mask: number): void => {
    const value = (level.format << 3) | mask;
    let rem = value;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const format = ((value << 10) | rem) ^ 0x5412;
    const bit = (i: number): boolean => ((format >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const info = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((info >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }

  // Data goes in two-module columns, zig-zagging up and down from the bottom right.
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (!reserved[y]?.[x] && index < codewords.length * 8) {
          (modules[y] as boolean[])[x] =
            (((codewords[index >>> 3] as number) >>> (7 - (index & 7))) & 1) !== 0;
          index++;
        }
      }
    }
  }

  // Try all eight masks and keep the one that scores best.
  const applyMask = (mask: number): void => {
    const test = MASKS[mask] as (x: number, y: number) => boolean;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!reserved[y]?.[x] && test(x, y))
          (modules[y] as boolean[])[x] = !(modules[y] as boolean[])[x];
      }
    }
  };
  let best = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask);
    drawFormat(mask);
    const score = penalty(modules, size);
    if (score < bestScore) {
      bestScore = score;
      best = mask;
    }
    applyMask(mask);
  }
  applyMask(best);
  drawFormat(best);
  return { size, version, modules };
}
