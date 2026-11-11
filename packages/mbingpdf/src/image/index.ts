/**
 * Image decoding: turns image files into what the PDF writer embeds.
 */
import type { PdfImage } from "../core/index.ts";
import { decodeJpeg, isJpeg } from "./jpeg.ts";
import { decodePng, isPng } from "./png.ts";

export { decodeJpeg, isJpeg } from "./jpeg.ts";
export { decodePng, isPng } from "./png.ts";
export { shrinkImage } from "./resize.ts";

/** The name of an image format this library does not read itself, from a file's first bytes. */
function foreignFormat(data: Uint8Array): string | undefined {
  const ascii = (from: number, to: number): string =>
    String.fromCharCode(...data.subarray(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "WebP";
  if (ascii(0, 4) === "GIF8") return "GIF";
  if (ascii(4, 8) === "ftyp" && /avif|avis/.test(ascii(8, 12))) return "AVIF";
  if (ascii(0, 2) === "BM") return "BMP";
  return undefined;
}

/** Decodes a JPEG or PNG file, telling them apart by their first bytes. */
export function decodeImage(data: Uint8Array): PdfImage {
  if (isJpeg(data)) return decodeJpeg(data);
  if (isPng(data)) return decodePng(data);
  const format = foreignFormat(data);
  throw new Error(
    format === "WebP"
      ? "WebP images are read by `await loadImage(bytes)`, or by `decodeWebp(bytes)` from " +
          '"mbingpdf/webp"; `Image` takes JPEG and PNG bytes directly'
      : format
        ? `${format} images cannot be read directly: only JPEG and PNG can. ` +
          "In a browser, `await loadImage(bytes)` reads them with the browser's own decoder."
        : "Unsupported image format: only JPEG and PNG can be embedded",
  );
}

/**
 * Reads an image file of any kind the runtime can show. JPEG and PNG are read as
 * {@link decodeImage} reads them, and WebP by this library's own decoder (loaded only when
 * needed), so all three work everywhere and give the same pixels everywhere. Anything else
 * (AVIF, GIF) is handed to the browser's own decoder, so it works in a browser or a Web Worker
 * but not on a server: there, convert the image to PNG or JPEG first. The result can be used
 * as the `src` of an `Image`.
 */
export async function loadImage(data: Uint8Array): Promise<PdfImage> {
  if (isJpeg(data) || isPng(data)) return decodeImage(data);
  if (foreignFormat(data) === "WebP") {
    const { decodeWebp } = await import("../webp/index.ts");
    return decodeWebp(data);
  }
  const format = foreignFormat(data) ?? "This kind of";
  const scope = globalThis as {
    createImageBitmap?: (
      source: Blob,
    ) => Promise<{ width: number; height: number; close?(): void }>;
    OffscreenCanvas?: new (
      width: number,
      height: number,
    ) => {
      getContext(kind: "2d"): {
        drawImage(image: unknown, x: number, y: number): void;
        getImageData(
          x: number,
          y: number,
          width: number,
          height: number,
        ): { data: Uint8ClampedArray };
      } | null;
    };
  };
  if (
    typeof scope.createImageBitmap !== "function" ||
    typeof scope.OffscreenCanvas !== "function"
  ) {
    throw new Error(
      `${format} image cannot be read on this runtime: it has no image decoder of its own. ` +
        "Convert the image to PNG or JPEG first.",
    );
  }
  let bitmap: { width: number; height: number; close?(): void };
  try {
    bitmap = await scope.createImageBitmap(new Blob([data as BlobPart]));
  } catch {
    throw new Error(`${format} image could not be decoded by this browser`);
  }
  const { width, height } = bitmap;
  const context = new scope.OffscreenCanvas(width, height).getContext("2d");
  if (!context) throw new Error("This runtime cannot draw images to read them");
  context.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const rgba = context.getImageData(0, 0, width, height).data;
  const rgb = new Uint8Array(width * height * 3);
  const alpha = new Uint8Array(width * height);
  let opaque = true;
  for (let i = 0; i < width * height; i++) {
    rgb[i * 3] = rgba[i * 4] as number;
    rgb[i * 3 + 1] = rgba[i * 4 + 1] as number;
    rgb[i * 3 + 2] = rgba[i * 4 + 2] as number;
    const a = rgba[i * 4 + 3] as number;
    alpha[i] = a;
    if (a !== 255) opaque = false;
  }
  return {
    width,
    height,
    colorSpace: "rgb",
    bitsPerComponent: 8,
    data: rgb,
    encoding: "raw",
    ...(opaque ? {} : { alpha }),
  };
}
