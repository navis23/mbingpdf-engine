/**
 * Renders PDF bytes to PNG with the two engines our users' viewers are built on: pdf.js
 * (Firefox) and PDFium (Chrome). Node only.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { PDFiumLibrary } from "@hyzyla/pdfium";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PNG } from "pngjs";

export type Renderer = "pdfjs" | "pdfium";

export interface RenderedPage {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel, on an opaque white background. */
  pixels: Uint8Array;
}

/** Pixels per point. 1.5 is enough to see hairlines and small text. */
export const RENDER_SCALE = 1.5;

const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));
// In Node, pdf.js reads this with the file system, so it must be a path, not a file: URL.
const standardFontDataUrl = `${join(pdfjsRoot, "standard_fonts")}/`;

function openPdfjs(pdf: Uint8Array) {
  return getDocument({
    // pdf.js takes ownership of the buffer, so hand it a copy.
    data: pdf.slice(),
    standardFontDataUrl,
    // Draw glyphs as paths from the font data instead of asking the system for fonts.
    disableFontFace: true,
    useSystemFonts: false,
    // Warnings stay on: a font that fails to load must not pass silently.
    verbosity: 1,
  });
}

async function renderWithPdfjs(pdf: Uint8Array): Promise<RenderedPage[]> {
  const task = openPdfjs(pdf);
  const pages: RenderedPage[] = [];
  try {
    const doc = await task.promise;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const width = Math.ceil(viewport.width);
      const height = Math.ceil(viewport.height);
      const canvas = createCanvas(width, height);
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      await page.render({
        // @napi-rs/canvas implements the canvas API but not the DOM types.
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      const image = context.getImageData(0, 0, width, height);
      pages.push({ width, height, pixels: new Uint8Array(image.data.buffer.slice(0)) });
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return pages;
}

let pdfium: Promise<PDFiumLibrary> | undefined;

async function renderWithPdfium(pdf: Uint8Array): Promise<RenderedPage[]> {
  pdfium ??= PDFiumLibrary.init();
  const library = await pdfium;
  const doc = await library.loadDocument(pdf);
  const pages: RenderedPage[] = [];
  try {
    for (const page of doc.pages()) {
      const image = await page.render({ scale: RENDER_SCALE, render: "bitmap" });
      pages.push({
        width: image.width,
        height: image.height,
        pixels: flattenOnWhite(image.data),
      });
    }
  } finally {
    doc.destroy();
  }
  return pages;
}

/** Composites RGBA pixels over white so both engines produce opaque images. */
function flattenOnWhite(rgba: Uint8Array): Uint8Array {
  const out = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const alpha = (rgba[i + 3] as number) / 255;
    out[i] = Math.round((rgba[i] as number) * alpha + 255 * (1 - alpha));
    out[i + 1] = Math.round((rgba[i + 1] as number) * alpha + 255 * (1 - alpha));
    out[i + 2] = Math.round((rgba[i + 2] as number) * alpha + 255 * (1 - alpha));
    out[i + 3] = 255;
  }
  return out;
}

export function renderPdf(renderer: Renderer, pdf: Uint8Array): Promise<RenderedPage[]> {
  return renderer === "pdfjs" ? renderWithPdfjs(pdf) : renderWithPdfium(pdf);
}

/** Extracts the text of each page with pdf.js, one string per run of text. */
export async function extractText(pdf: Uint8Array): Promise<string[][]> {
  const task = openPdfjs(pdf);
  const pages: string[][] = [];
  try {
    const doc = await task.promise;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const runs: string[] = [];
      for (const item of content.items) {
        if ("str" in item && item.str.trim() !== "") runs.push(item.str);
      }
      pages.push(runs);
    }
  } finally {
    await task.destroy();
  }
  return pages;
}

export function encodePng(page: RenderedPage): Uint8Array {
  const png = new PNG({ width: page.width, height: page.height });
  png.data.set(page.pixels);
  return PNG.sync.write(png, { colorType: 2, inputHasAlpha: true });
}

export function decodePng(bytes: Uint8Array): RenderedPage {
  const png = PNG.sync.read(Buffer.from(bytes));
  return { width: png.width, height: png.height, pixels: new Uint8Array(png.data) };
}
