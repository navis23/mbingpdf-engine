/** Writes a decoded image back out as a PNG file, for embedding in SVG. */
import { zlibSync } from "fflate";
import type { PdfImage } from "../core/index.ts";

let crcTable: Uint32Array | undefined;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crcTable[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Prefixes every row with filter type 0 ("none") and compresses the lot. */
function pack(rows: Uint8Array, rowBytes: number, height: number): Uint8Array {
  const raw = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    raw.set(rows.subarray(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1);
  }
  return zlibSync(raw, { level: 6 });
}

/** Encodes an image that is not a JPEG as a PNG file. */
export function encodePng(image: PdfImage): Uint8Array {
  const { width, height } = image;
  const depth = image.bitsPerComponent;
  let colorType: number;
  let bits: number = depth;
  let data: Uint8Array;
  let palette: Uint8Array | undefined;

  if (!image.alpha) {
    if (image.colorSpace === "cmyk") throw new Error("CMYK images cannot be shown in SVG");
    colorType = image.colorSpace === "gray" ? 0 : image.colorSpace === "rgb" ? 2 : 3;
    palette = image.palette;
    const channels = image.colorSpace === "rgb" ? 3 : 1;
    data =
      image.encoding === "png"
        ? image.data
        : pack(image.data, (width * channels * depth + 7) >> 3, height);
  } else {
    // With transparency: write 8-bit RGBA, expanding whatever the colour samples are.
    colorType = 6;
    bits = 8;
    const rgba = new Uint8Array(width * height * 4);
    const channels = image.colorSpace === "rgb" ? 3 : 1;
    const rowBytes = (width * channels * depth + 7) >> 3;
    const sample = (y: number, x: number, channel: number): number => {
      if (depth === 16) return image.data[y * rowBytes + (x * channels + channel) * 2] as number;
      if (depth === 8) return image.data[y * rowBytes + x * channels + channel] as number;
      const bit = x * depth;
      return (
        ((image.data[y * rowBytes + (bit >> 3)] as number) >> (8 - depth - (bit & 7))) &
        ((1 << depth) - 1)
      );
    };
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4;
        if (image.colorSpace === "indexed") {
          const index = sample(y, x, 0) * 3;
          rgba[at] = image.palette?.[index] ?? 0;
          rgba[at + 1] = image.palette?.[index + 1] ?? 0;
          rgba[at + 2] = image.palette?.[index + 2] ?? 0;
        } else if (image.colorSpace === "gray") {
          // Scale 1-, 2- and 4-bit greys up to 8 bits.
          const value =
            depth < 8 ? Math.round((sample(y, x, 0) * 255) / ((1 << depth) - 1)) : sample(y, x, 0);
          rgba[at] = rgba[at + 1] = rgba[at + 2] = value;
        } else {
          rgba[at] = sample(y, x, 0);
          rgba[at + 1] = sample(y, x, 1);
          rgba[at + 2] = sample(y, x, 2);
        }
        rgba[at + 3] = image.alpha[y * width + x] as number;
      }
    }
    data = pack(rgba, width * 4, height);
  }

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = bits;
  header[9] = colorType;
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    ...(palette ? [chunk("PLTE", palette)] : []),
    chunk("IDAT", data),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
