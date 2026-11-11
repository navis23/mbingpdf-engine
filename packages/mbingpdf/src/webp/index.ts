/**
 * WebP images, decoded without the platform: lossless (VP8L), lossy (VP8) and lossy with an
 * alpha plane, in the simple and extended file formats. Animated files are not read.
 *
 * @module
 */
import type { PdfImage } from "../core/index.ts";
import { decodeLossless, decodeLosslessStream } from "./lossless.ts";
import { decodeLossy, vp8Size } from "./lossy.ts";

const fourCc = (data: Uint8Array, at: number): string =>
  String.fromCharCode(
    data[at] as number,
    data[at + 1] as number,
    data[at + 2] as number,
    data[at + 3] as number,
  );
const uint32 = (data: Uint8Array, at: number): number =>
  ((data[at] as number) |
    ((data[at + 1] as number) << 8) |
    ((data[at + 2] as number) << 16) |
    ((data[at + 3] as number) << 24)) >>>
  0;
const uint24 = (data: Uint8Array, at: number): number =>
  (data[at] as number) | ((data[at + 1] as number) << 8) | ((data[at + 2] as number) << 16);

/** Whether the bytes are a WebP file. */
export function isWebp(data: Uint8Array): boolean {
  return data.length >= 12 && fourCc(data, 0) === "RIFF" && fourCc(data, 8) === "WEBP";
}

interface Chunk {
  readonly start: number;
  readonly end: number;
}

/** Undoes the prediction filter of an alpha plane, in place. */
function unfilterAlpha(alpha: Uint8Array, width: number, height: number, method: number): void {
  if (method === 0) return;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    if (y === 0 || method === 1) {
      // Horizontal: from the left; the first pixel of a row from the one above it.
      let previous = y === 0 ? 0 : (alpha[row - width] as number);
      for (let x = 0; x < width; x++) {
        previous = ((alpha[row + x] as number) + previous) & 0xff;
        alpha[row + x] = previous;
      }
    } else if (method === 2) {
      // Vertical: from the pixel above.
      for (let x = 0; x < width; x++)
        alpha[row + x] = ((alpha[row + x] as number) + (alpha[row - width + x] as number)) & 0xff;
    } else {
      // Gradient: left + above - above-left, clamped.
      let left = alpha[row - width] as number;
      let topLeft = left;
      for (let x = 0; x < width; x++) {
        const top = alpha[row - width + x] as number;
        const g = left + top - topLeft;
        left = ((alpha[row + x] as number) + (g < 0 ? 0 : Math.min(g, 255))) & 0xff;
        topLeft = top;
        alpha[row + x] = left;
      }
    }
  }
}

/** Decodes the payload of an "ALPH" chunk to one opacity byte per pixel. */
function decodeAlpha(data: Uint8Array, chunk: Chunk, width: number, height: number): Uint8Array {
  if (chunk.end <= chunk.start)
    throw new Error("The WebP image data is damaged: the alpha chunk is empty");
  const header = data[chunk.start] as number;
  const compression = header & 3;
  const filter = (header >> 2) & 3;
  if (compression > 1 || (header >> 4) & 2 || header >> 6) {
    throw new Error("The WebP image data is damaged: unknown alpha coding");
  }
  let alpha: Uint8Array;
  if (compression === 0) {
    if (chunk.end - chunk.start - 1 < width * height)
      throw new Error("The WebP image data is cut short");
    alpha = data.slice(chunk.start + 1, chunk.start + 1 + width * height);
  } else {
    // A lossless image stream without its header, the opacity in the green channel.
    const pixels = decodeLosslessStream(data, chunk.start + 1, chunk.end, width, height);
    alpha = new Uint8Array(width * height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = ((pixels[i] as number) >> 8) & 0xff;
  }
  unfilterAlpha(alpha, width, height, filter);
  return alpha;
}

function image(
  width: number,
  height: number,
  rgb: Uint8Array,
  alpha: Uint8Array | undefined,
): PdfImage {
  let opaque = true;
  if (alpha) for (let i = 0; i < alpha.length && opaque; i++) opaque = alpha[i] === 255;
  return {
    width,
    height,
    colorSpace: "rgb",
    bitsPerComponent: 8,
    data: rgb,
    encoding: "raw",
    ...(alpha && !opaque ? { alpha } : {}),
  };
}

/**
 * Decodes a WebP file: lossless, lossy, or lossy with transparency. The pixels are the ones
 * libwebp produces. Animated WebP files are refused; ICC profiles and EXIF data are ignored.
 * The result can be used as the `src` of an `Image`.
 */
export function decodeWebp(input: Uint8Array): PdfImage {
  const data = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (!isWebp(data)) throw new Error("Not a WebP file");
  const end = Math.min(data.length, 8 + uint32(data, 4));

  let canvas: { width: number; height: number } | undefined;
  let alphaChunk: Chunk | undefined;
  let at = 12;
  while (at + 8 <= end) {
    const kind = fourCc(data, at);
    const size = uint32(data, at + 4);
    const start = at + 8;
    const chunkEnd = start + size;
    if (chunkEnd > end) throw new Error("The WebP image data is cut short");
    if (kind === "VP8X") {
      if (size < 10) throw new Error("The WebP image data is damaged: short extended header");
      if ((data[start] as number) & 0x02) {
        throw new Error("Animated WebP images are not supported: use a still image");
      }
      canvas = { width: uint24(data, start + 4) + 1, height: uint24(data, start + 7) + 1 };
    } else if (kind === "ALPH") {
      alphaChunk ??= { start, end: chunkEnd };
    } else if (kind === "VP8L") {
      const { width, height, pixels } = decodeLossless(data, start, chunkEnd);
      checkCanvas(canvas, width, height);
      const rgb = new Uint8Array(width * height * 3);
      const alpha = new Uint8Array(width * height);
      for (let i = 0; i < pixels.length; i++) {
        const argb = pixels[i] as number;
        rgb[i * 3] = (argb >> 16) & 0xff;
        rgb[i * 3 + 1] = (argb >> 8) & 0xff;
        rgb[i * 3 + 2] = argb & 0xff;
        alpha[i] = argb >>> 24;
      }
      return image(width, height, rgb, alpha);
    } else if (kind === "VP8 ") {
      const size = vp8Size(data, start, chunkEnd);
      checkCanvas(canvas, size.width, size.height);
      const alpha =
        canvas && alphaChunk ? decodeAlpha(data, alphaChunk, size.width, size.height) : undefined;
      const { width, height, rgb } = decodeLossy(data, start, chunkEnd);
      return image(width, height, rgb, alpha);
    }
    at = chunkEnd + (size & 1);
  }
  throw new Error("The WebP file holds no image");
}

function checkCanvas(
  canvas: { width: number; height: number } | undefined,
  width: number,
  height: number,
): void {
  if (canvas && (canvas.width !== width || canvas.height !== height)) {
    throw new Error("The WebP image data is damaged: the picture and the canvas differ in size");
  }
}
