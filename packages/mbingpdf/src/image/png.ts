import { unzlibSync } from "fflate";
import type { PdfImage } from "../core/index.ts";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPng(data: Uint8Array): boolean {
  return data.length > 8 && SIGNATURE.every((byte, i) => data[i] === byte);
}

/** Samples per pixel for each PNG colour type. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const VALID_DEPTHS: Record<number, readonly number[]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};

/** Reverses PNG row filtering in place and returns the rows without their filter bytes. */
function unfilter(
  data: Uint8Array,
  rowBytes: number,
  rows: number,
  pixelBytes: number,
): Uint8Array {
  if (data.length < (rowBytes + 1) * rows)
    throw new Error("Malformed PNG: image data is cut short");
  const out = new Uint8Array(rowBytes * rows);
  for (let y = 0; y < rows; y++) {
    const filter = data[y * (rowBytes + 1)] as number;
    const source = y * (rowBytes + 1) + 1;
    const target = y * rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const raw = data[source + x] as number;
      const left = x >= pixelBytes ? (out[target + x - pixelBytes] as number) : 0;
      const up = y > 0 ? (out[target + x - rowBytes] as number) : 0;
      const upLeft =
        y > 0 && x >= pixelBytes ? (out[target + x - rowBytes - pixelBytes] as number) : 0;
      let value: number;
      if (filter === 0) value = raw;
      else if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + up;
      else if (filter === 3) value = raw + ((left + up) >> 1);
      else if (filter === 4) {
        // Paeth: whichever neighbour is closest to left + up - upLeft.
        const estimate = left + up - upLeft;
        const dLeft = Math.abs(estimate - left);
        const dUp = Math.abs(estimate - up);
        const dUpLeft = Math.abs(estimate - upLeft);
        value = raw + (dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft);
      } else throw new Error(`Malformed PNG: unknown row filter ${filter}`);
      out[target + x] = value & 0xff;
    }
  }
  return out;
}

// Adam7 interlacing: where each of the seven passes starts and how far apart its pixels are.
const PASS_X = [0, 4, 0, 2, 0, 1, 0];
const PASS_Y = [0, 0, 4, 0, 2, 0, 1];
const PASS_DX = [8, 8, 4, 4, 2, 2, 1];
const PASS_DY = [8, 8, 8, 4, 4, 2, 2];

/** Decodes a PNG file. */
export function decodePng(input: Uint8Array): PdfImage {
  const data = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (!isPng(data)) throw new Error("Not a PNG file");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  let header:
    | { width: number; height: number; depth: number; colorType: number; interlaced: boolean }
    | undefined;
  let palette: Uint8Array | undefined;
  let transparency: Uint8Array | undefined;
  const idat: Uint8Array[] = [];
  let ended = false;
  for (let offset = 8; offset + 12 <= data.length; ) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...data.subarray(offset + 4, offset + 8));
    const body = data.subarray(offset + 8, offset + 8 + length);
    if (offset + 12 + length > data.length)
      throw new Error("Malformed PNG: chunk runs past the end of the file");
    if (type === "IHDR") {
      if (length !== 13) throw new Error("Malformed PNG: bad header length");
      header = {
        width: view.getUint32(offset + 8),
        height: view.getUint32(offset + 12),
        depth: body[8] as number,
        colorType: body[9] as number,
        interlaced: body[12] === 1,
      };
      if (body[10] !== 0 || body[11] !== 0 || (body[12] as number) > 1) {
        throw new Error("Malformed PNG: unknown compression, filter or interlace method");
      }
    } else if (type === "PLTE") palette = body;
    else if (type === "tRNS") transparency = body;
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") {
      ended = true;
      break;
    }
    offset += 12 + length;
  }
  if (!header) throw new Error("Malformed PNG: no header");
  const { width, height, depth, colorType, interlaced } = header;
  if (width === 0 || height === 0) throw new Error("Malformed PNG: zero size");
  if (!VALID_DEPTHS[colorType]?.includes(depth)) {
    throw new Error(`Malformed PNG: colour type ${colorType} with bit depth ${depth}`);
  }
  if (idat.length === 0 || !ended)
    throw new Error("Malformed PNG: missing image data or end marker");
  if (colorType === 3 && (!palette || palette.length === 0 || palette.length % 3 !== 0)) {
    throw new Error("Malformed PNG: palette image without a valid palette");
  }

  let compressed = idat[0] as Uint8Array;
  if (idat.length > 1) {
    let total = 0;
    for (const chunk of idat) total += chunk.length;
    compressed = new Uint8Array(total);
    let at = 0;
    for (const chunk of idat) {
      compressed.set(chunk, at);
      at += chunk.length;
    }
  }

  const channels = CHANNELS[colorType] as number;
  const colorSpace =
    colorType === 3 ? "indexed" : colorType === 0 || colorType === 4 ? "gray" : "rgb";
  const bitsPerComponent = depth as 1 | 2 | 4 | 8 | 16;
  const hasAlpha = colorType === 4 || colorType === 6 || transparency !== undefined;

  // The common case needs no decoding at all: PDF's Flate filter understands PNG row filters.
  if (!interlaced && !hasAlpha) {
    return {
      width,
      height,
      colorSpace,
      bitsPerComponent,
      data: compressed,
      encoding: "png",
      ...(colorType === 3 && palette ? { palette } : {}),
    };
  }

  let inflated: Uint8Array;
  try {
    inflated = unzlibSync(compressed);
  } catch {
    throw new Error("Malformed PNG: image data cannot be decompressed");
  }
  const pixelBits = channels * depth;
  const pixelBytes = Math.max(1, pixelBits >> 3);
  const rowBytes = (width * pixelBits + 7) >> 3;
  // `pixels` holds whole rows of packed samples, as in a non-interlaced file.
  let pixels: Uint8Array;
  if (!interlaced) {
    pixels = unfilter(inflated, rowBytes, height, pixelBytes);
  } else {
    pixels = new Uint8Array(rowBytes * height);
    let offset = 0;
    for (let pass = 0; pass < 7; pass++) {
      const passWidth = Math.ceil((width - (PASS_X[pass] as number)) / (PASS_DX[pass] as number));
      const passHeight = Math.ceil((height - (PASS_Y[pass] as number)) / (PASS_DY[pass] as number));
      if (passWidth <= 0 || passHeight <= 0) continue;
      const passRowBytes = (passWidth * pixelBits + 7) >> 3;
      const size = (passRowBytes + 1) * passHeight;
      const rows = unfilter(
        inflated.subarray(offset, offset + size),
        passRowBytes,
        passHeight,
        pixelBytes,
      );
      offset += size;
      for (let y = 0; y < passHeight; y++) {
        const targetY = (PASS_Y[pass] as number) + y * (PASS_DY[pass] as number);
        for (let x = 0; x < passWidth; x++) {
          const targetX = (PASS_X[pass] as number) + x * (PASS_DX[pass] as number);
          if (pixelBits >= 8) {
            const from = y * passRowBytes + x * pixelBytes;
            const to = targetY * rowBytes + targetX * pixelBytes;
            for (let b = 0; b < pixelBytes; b++) pixels[to + b] = rows[from + b] as number;
          } else {
            // Packed samples of 1, 2 or 4 bits.
            const fromBit = x * pixelBits;
            const value =
              ((rows[y * passRowBytes + (fromBit >> 3)] as number) >>
                (8 - pixelBits - (fromBit & 7))) &
              ((1 << pixelBits) - 1);
            const toBit = targetX * pixelBits;
            const index = targetY * rowBytes + (toBit >> 3);
            pixels[index] = (pixels[index] as number) | (value << (8 - pixelBits - (toBit & 7)));
          }
        }
      }
    }
  }

  if (!hasAlpha) {
    return {
      width,
      height,
      colorSpace,
      bitsPerComponent,
      data: pixels,
      encoding: "raw",
      ...(colorType === 3 && palette ? { palette } : {}),
    };
  }

  // Split transparency off into an 8-bit mask; the colour samples stay as they are.
  const alpha = new Uint8Array(width * height);
  const sampleBytes = depth === 16 ? 2 : 1;
  if (colorType === 4 || colorType === 6) {
    const colorChannels = channels - 1;
    const color = new Uint8Array(width * height * colorChannels * sampleBytes);
    const colorRow = width * colorChannels * sampleBytes;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const from = y * rowBytes + x * pixelBytes;
        const to = y * colorRow + x * colorChannels * sampleBytes;
        for (let b = 0; b < colorChannels * sampleBytes; b++)
          color[to + b] = pixels[from + b] as number;
        // For 16-bit alpha the high byte is the 8-bit value.
        alpha[y * width + x] = pixels[from + colorChannels * sampleBytes] as number;
      }
    }
    return { width, height, colorSpace, bitsPerComponent, data: color, encoding: "raw", alpha };
  }

  const table = transparency as Uint8Array;
  const sampleAt = (y: number, x: number, channel: number): number => {
    if (depth === 16) {
      const at = y * rowBytes + (x * channels + channel) * 2;
      return ((pixels[at] as number) << 8) | (pixels[at + 1] as number);
    }
    if (depth === 8) return pixels[y * rowBytes + x * channels + channel] as number;
    const bit = x * depth;
    return (
      ((pixels[y * rowBytes + (bit >> 3)] as number) >> (8 - depth - (bit & 7))) &
      ((1 << depth) - 1)
    );
  };
  if (colorType === 3) {
    // One alpha value per palette entry; entries beyond the table are opaque.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) alpha[y * width + x] = table[sampleAt(y, x, 0)] ?? 255;
    }
  } else {
    // One colour is fully transparent; everything else is opaque.
    const key: number[] = [];
    for (let c = 0; c < channels; c++)
      key.push(((table[c * 2] as number) << 8) | (table[c * 2 + 1] as number));
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let matches = true;
        for (let c = 0; c < channels && matches; c++) matches = sampleAt(y, x, c) === key[c];
        alpha[y * width + x] = matches ? 0 : 255;
      }
    }
  }
  return {
    width,
    height,
    colorSpace,
    bitsPerComponent,
    data: pixels,
    encoding: "raw",
    alpha,
    ...(colorType === 3 && palette ? { palette } : {}),
  };
}
