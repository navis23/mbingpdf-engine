/**
 * Image decoding: turns image files into what the PDF writer embeds.
 */
import type { PdfImage } from "../core/index.ts";
import { decodeJpeg, isJpeg } from "./jpeg.ts";
import { decodePng, isPng } from "./png.ts";

export { decodeJpeg, isJpeg } from "./jpeg.ts";
export { decodePng, isPng } from "./png.ts";

/** Decodes a JPEG or PNG file, telling them apart by their first bytes. */
export function decodeImage(data: Uint8Array): PdfImage {
  if (isJpeg(data)) return decodeJpeg(data);
  if (isPng(data)) return decodePng(data);
  throw new Error("Unsupported image format: only JPEG and PNG can be embedded");
}
