import type { PdfImage } from "../core/index.ts";

export function isJpeg(data: Uint8Array): boolean {
  return data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
}

/** Reads the EXIF orientation from an APP1 segment's payload, or undefined. */
function exifOrientation(segment: Uint8Array): number | undefined {
  // "Exif\0\0", then a TIFF header.
  if (segment.length < 14 || String.fromCharCode(...segment.subarray(0, 4)) !== "Exif")
    return undefined;
  const tiff = segment.subarray(6);
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const little = view.getUint16(0) === 0x4949;
  if (view.getUint16(2, little) !== 42) return undefined;
  const directory = view.getUint32(4, little);
  if (directory + 2 > tiff.length) return undefined;
  const count = view.getUint16(directory, little);
  for (let i = 0; i < count; i++) {
    const entry = directory + 2 + i * 12;
    if (entry + 12 > tiff.length) break;
    if (view.getUint16(entry, little) === 0x0112) {
      const value = view.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? value : undefined;
    }
  }
  return undefined;
}

/**
 * Reads a JPEG's size and colour model. The file itself becomes the image data: PDF viewers
 * decode JPEG natively, so nothing is re-compressed and no quality is lost.
 */
export function decodeJpeg(input: Uint8Array): PdfImage {
  const data = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (!isJpeg(data)) throw new Error("Not a JPEG file");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let orientation: number | undefined;
  let adobe = false;
  let offset = 2;
  while (offset + 4 <= data.length) {
    if (data[offset] !== 0xff) throw new Error("Malformed JPEG: marker expected");
    const marker = data[offset + 1] as number;
    // Padding and markers without a payload.
    if (marker === 0xff) {
      offset++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = view.getUint16(offset + 2);
    const payload = data.subarray(offset + 4, offset + 2 + length);
    if (marker === 0xe1) orientation ??= exifOrientation(payload);
    else if (marker === 0xee && String.fromCharCode(...payload.subarray(0, 5)) === "Adobe")
      adobe = true;
    else if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      // Start of frame: sample precision, height, width, number of components.
      if (payload.length < 6) throw new Error("Malformed JPEG: frame header too short");
      const precision = payload[0] as number;
      const height = view.getUint16(offset + 5);
      const width = view.getUint16(offset + 7);
      const components = payload[5] as number;
      if (precision !== 8) throw new Error(`Unsupported JPEG: ${precision}-bit samples`);
      if (width === 0 || height === 0) throw new Error("Malformed JPEG: zero size");
      const colorSpace =
        components === 1
          ? "gray"
          : components === 3
            ? "rgb"
            : components === 4
              ? "cmyk"
              : undefined;
      if (!colorSpace) throw new Error(`Unsupported JPEG: ${components} colour components`);
      return {
        width,
        height,
        colorSpace,
        bitsPerComponent: 8,
        data,
        encoding: "jpeg",
        // Adobe software writes CMYK JPEGs with every value inverted.
        ...(colorSpace === "cmyk" && adobe ? { invert: true } : {}),
        ...(orientation !== undefined && orientation !== 1 ? { orientation } : {}),
      };
    }
    if (marker === 0xda) break;
    offset += 2 + length;
  }
  throw new Error("Malformed JPEG: no frame header found");
}
