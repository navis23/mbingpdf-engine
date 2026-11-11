import { unzlibSync } from "fflate";
import type { PdfImage } from "../core/index.ts";
import { unfilter } from "./png.ts";

/** The 8-bit samples of an image, pixel by pixel, or nothing when they cannot be had. */
function samplesOf(
  image: PdfImage,
): { data: Uint8Array; channels: number; colorSpace: "gray" | "rgb" | "cmyk" } | undefined {
  if (image.encoding === "jpeg" || image.bitsPerComponent > 8) return undefined;
  const { width, height, colorSpace, bitsPerComponent: bits } = image;
  if (colorSpace !== "indexed" && bits !== 8) return undefined;
  const channels = colorSpace === "rgb" ? 3 : colorSpace === "cmyk" ? 4 : 1;
  const rowBytes = (width * channels * bits + 7) >> 3;
  let rows = image.data;
  if (image.encoding === "png") {
    try {
      rows = unfilter(unzlibSync(image.data), rowBytes, height, channels);
    } catch {
      return undefined;
    }
  }
  if (rows.length < rowBytes * height) return undefined;
  if (colorSpace !== "indexed") return { data: rows, channels, colorSpace };

  const palette = image.palette ?? new Uint8Array(3);
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const bit = x * bits;
      const index =
        ((rows[y * rowBytes + (bit >> 3)] as number) >> (8 - bits - (bit & 7))) & ((1 << bits) - 1);
      const to = (y * width + x) * 3;
      data[to] = palette[index * 3] ?? 0;
      data[to + 1] = palette[index * 3 + 1] ?? 0;
      data[to + 2] = palette[index * 3 + 2] ?? 0;
    }
  }
  return { data, channels: 3, colorSpace: "rgb" };
}

/** For each pixel of the smaller side: the first source pixel under it and each one's share. */
function shares(from: number, to: number): { start: number; weights: number[] }[] {
  const scale = from / to;
  const out: { start: number; weights: number[] }[] = [];
  for (let i = 0; i < to; i++) {
    const a = i * scale;
    const b = Math.min(from, (i + 1) * scale);
    const start = Math.floor(a);
    const weights: number[] = [];
    for (let j = start; j < b && j < from; j++) {
      weights.push((Math.min(b, j + 1) - Math.max(a, j)) / scale);
    }
    out.push({ start, weights });
  }
  return out;
}

/**
 * The same picture with fewer pixels: each new pixel is the average of the ones it covers.
 * Sizes are in stored pixels (before any orientation). Returns the image itself when it is
 * not larger than asked, or when its samples cannot be read here: a JPEG, which is embedded
 * as the file it is, and 16-bit or packed grey images.
 */
export function shrinkImage(image: PdfImage, width: number, height: number): PdfImage {
  const w = Math.max(1, Math.min(image.width, Math.round(width)));
  const h = Math.max(1, Math.min(image.height, Math.round(height)));
  if (w === image.width && h === image.height) return image;
  const source = samplesOf(image);
  if (!source) return image;
  const { channels } = source;
  const mask = image.alpha;
  const columns = shares(image.width, w);
  const rows = shares(image.height, h);
  const data = new Uint8Array(w * h * channels);
  const alpha = mask ? new Uint8Array(w * h) : undefined;
  const sum = new Float64Array(channels);
  for (let y = 0; y < h; y++) {
    const row = rows[y] as { start: number; weights: number[] };
    for (let x = 0; x < w; x++) {
      const column = columns[x] as { start: number; weights: number[] };
      sum.fill(0);
      let opacity = 0;
      for (let j = 0; j < row.weights.length; j++) {
        const line = (row.start + j) * image.width;
        for (let i = 0; i < column.weights.length; i++) {
          const at = line + column.start + i;
          // A transparent pixel has no colour to give: weigh each colour by its opacity.
          const share =
            (row.weights[j] as number) *
            (column.weights[i] as number) *
            (mask ? (mask[at] as number) / 255 : 1);
          opacity += share;
          for (let c = 0; c < channels; c++) {
            sum[c] = (sum[c] as number) + share * (source.data[at * channels + c] as number);
          }
        }
      }
      const to = y * w + x;
      if (opacity > 0) {
        for (let c = 0; c < channels; c++)
          data[to * channels + c] = Math.round((sum[c] as number) / opacity);
      }
      if (alpha) alpha[to] = Math.round(opacity * 255);
    }
  }
  return {
    width: w,
    height: h,
    colorSpace: source.colorSpace,
    bitsPerComponent: 8,
    data,
    encoding: "raw",
    ...(alpha ? { alpha } : {}),
    ...(image.orientation !== undefined ? { orientation: image.orientation } : {}),
  };
}
