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
    // pdf.js takes ownership of the buffer and rejects Node Buffers, so hand it a plain copy.
    data: Uint8Array.from(pdf),
    standardFontDataUrl,
    // Draw glyphs as paths from the font data instead of asking the system for fonts.
    disableFontFace: true,
    useSystemFonts: false,
    // Warnings stay on: a font that fails to load must not pass silently.
    verbosity: 1,
  });
}

async function renderWithPdfjs(pdf: Uint8Array, scale: number): Promise<RenderedPage[]> {
  const task = openPdfjs(pdf);
  const pages: RenderedPage[] = [];
  try {
    const doc = await task.promise;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale });
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

async function renderWithPdfium(pdf: Uint8Array, scale: number): Promise<RenderedPage[]> {
  pdfium ??= PDFiumLibrary.init();
  const library = await pdfium;
  const doc = await library.loadDocument(pdf);
  const pages: RenderedPage[] = [];
  try {
    for (const page of doc.pages()) {
      const image = await page.render({ scale, render: "bitmap" });
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

export function renderPdf(
  renderer: Renderer,
  pdf: Uint8Array,
  scale: number = RENDER_SCALE,
): Promise<RenderedPage[]> {
  return renderer === "pdfjs" ? renderWithPdfjs(pdf, scale) : renderWithPdfium(pdf, scale);
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

/**
 * The logical structure of a tagged PDF as pdf.js reads it: for each page, an outline with one
 * line per element that has content there, indented by depth: `"  P: Hello"`. A description
 * is shown in brackets: `"Figure [Logo]"`.
 */
export async function structureOutline(pdf: Uint8Array): Promise<string[][]> {
  interface Node {
    role?: string;
    alt?: string;
    type?: string;
    id?: string;
    children?: Node[];
  }
  const task = openPdfjs(pdf);
  const pages: string[][] = [];
  try {
    const doc = await task.promise;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      // The text of each run of marked content, by the run's id.
      const content = await page.getTextContent({ includeMarkedContent: true });
      const texts = new Map<string, string>();
      const open: string[] = [];
      for (const item of content.items) {
        if ("str" in item) {
          const id = open.at(-1);
          if (id !== undefined) texts.set(id, (texts.get(id) ?? "") + item.str);
        } else if (item.type === "beginMarkedContentProps" || item.type === "beginMarkedContent") {
          open.push(item.id ?? "");
        } else if (item.type === "endMarkedContent") open.pop();
      }
      const lines: string[] = [];
      const walk = (node: Node, depth: number): void => {
        const kids = node.children ?? [];
        const text = kids
          .filter((kid) => kid.type === "content" && kid.id !== undefined)
          .map((kid) => texts.get(kid.id as string) ?? "")
          .join("")
          .trim();
        const links = kids.filter(
          (kid) => kid.type === "object" || kid.type === "annotation",
        ).length;
        lines.push(
          "  ".repeat(depth) +
            (node.role ?? "?") +
            (node.alt !== undefined ? ` [${node.alt}]` : "") +
            (links > 0 ? ` (${links} link${links > 1 ? "s" : ""})` : "") +
            (text ? `: ${text}` : ""),
        );
        for (const kid of kids) if (kid.role !== undefined) walk(kid, depth + 1);
      };
      const tree = (await page.getStructTree()) as Node | null;
      for (const kid of tree?.children ?? []) walk(kid, 0);
      pages.push(lines);
    }
  } finally {
    await task.destroy();
  }
  return pages;
}
