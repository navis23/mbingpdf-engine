/**
 * `mbingpdf/svg` — the SVG backend: one SVG image per page, from the same layout that makes
 * the PDF. For showing a document on screen, where inline PDF viewing is unreliable (phones
 * in particular).
 */
import type { Color, PdfImage } from "../core/index.ts";
import { StandardFont } from "../core/index.ts";
import type { OutlineCommand } from "../font/index.ts";
import type { DisplayItem, DisplayPage, PathCommand } from "../layout/display.ts";
import { type DocumentLayout, layoutDocument } from "../layout/render.ts";
import type { LayoutNode } from "../layout/types.ts";
import type { TextFont } from "../text/index.ts";
import { encodePng } from "./png.ts";

/** Formats a number for SVG: at most three decimals, no trailing zeros. */
function n(value: number): string {
  const text = value.toFixed(3);
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

const escapeXml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function css(color: Color): string {
  const byte = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 255);
  if (color.space === "gray")
    return `rgb(${byte(color.gray)},${byte(color.gray)},${byte(color.gray)})`;
  if (color.space === "rgb") return `rgb(${byte(color.r)},${byte(color.g)},${byte(color.b)})`;
  // A screen cannot show CMYK or spot inks; this is the plain conversion, good enough for a
  // preview. A spot colour is shown as its process alternate at the given tint.
  const { c, m, y, k } = color.space === "spot" ? color.alternate : color;
  const tint = color.space === "spot" ? color.tint : 1;
  return `rgb(${byte(1 - tint * (1 - (1 - c) * (1 - k)))},${byte(1 - tint * (1 - (1 - m) * (1 - k)))},${byte(1 - tint * (1 - (1 - y) * (1 - k)))})`;
}

function pathData(commands: readonly (PathCommand | OutlineCommand)[]): string {
  let d = "";
  for (const command of commands) {
    if (command[0] === "R") {
      // A rectangle, written with relative horizontal and vertical lines.
      d += `M${n(command[1])} ${n(command[2])}h${n(command[3])}v${n(command[4])}h${n(-command[3])}Z`;
      continue;
    }
    d += command[0];
    for (let i = 1; i < command.length; i++) d += `${i > 1 ? " " : ""}${n(command[i] as number)}`;
  }
  return d;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

const imageUris: WeakMap<PdfImage, string> = new WeakMap();

function imageUri(image: PdfImage): string {
  let uri = imageUris.get(image);
  if (!uri) {
    uri =
      image.encoding === "jpeg"
        ? `data:image/jpeg;base64,${base64(image.data)}`
        : `data:image/png;base64,${base64(encodePng(image))}`;
    imageUris.set(image, uri);
  }
  return uri;
}

/**
 * A link's address if it is safe to put in a page that a browser shows, otherwise undefined.
 * Only web, mail and phone addresses pass: an SVG placed in a web page runs `javascript:`
 * links when they are clicked, and a document's links may come from user data.
 */
export function safeUrl(url: string): string | undefined {
  return /^(https?:|mailto:|tel:)/i.test(url.trim()) ? url.trim() : undefined;
}

/** A font that can give the shapes of its glyphs. */
interface OutlineFont {
  glyphOutline(glyph: number): readonly OutlineCommand[];
  unitsPerEm: number;
}

const hasOutlines = (font: TextFont): font is TextFont & OutlineFont =>
  typeof (font as Partial<OutlineFont>).glyphOutline === "function";

/** The CSS font that stands in for a standard PDF font, which has no outlines to draw. */
function standardFontCss(font: StandardFont): string {
  const name = font.name;
  const family = name.startsWith("Courier")
    ? "'Courier New',Courier,monospace"
    : name.startsWith("Times")
      ? "'Times New Roman',Times,serif"
      : "Helvetica,Arial,sans-serif";
  const weight = name.includes("Bold") ? ' font-weight="bold"' : "";
  const style = name.includes("Oblique") || name.includes("Italic") ? ' font-style="italic"' : "";
  return `font-family="${family}"${weight}${style}`;
}

class PageWriter {
  readonly defs: string[] = [];
  readonly #fontIds: Map<TextFont, number> = new Map();
  readonly #glyphs: Set<string> = new Set();
  #clips = 0;

  /** The id of a glyph's shape in `<defs>`, defining it on first use. */
  glyph(font: TextFont & OutlineFont, glyph: number): string {
    let fontId = this.#fontIds.get(font);
    if (fontId === undefined) {
      fontId = this.#fontIds.size + 1;
      this.#fontIds.set(font, fontId);
    }
    const id = `f${fontId}g${glyph}`;
    if (!this.#glyphs.has(id)) {
      this.#glyphs.add(id);
      this.defs.push(`<path id="${id}" d="${pathData(font.glyphOutline(glyph))}"/>`);
    }
    return id;
  }

  items(items: readonly DisplayItem[]): string {
    let out = "";
    for (const item of items) {
      switch (item.type) {
        case "path": {
          const fill = item.fill ? css(item.fill) : "none";
          let attributes = ` fill="${fill}"`;
          if (item.evenOdd) attributes += ' fill-rule="evenodd"';
          if (item.stroke) {
            attributes += ` stroke="${css(item.stroke.color)}" stroke-width="${n(item.stroke.width)}"`;
            if (item.stroke.dash?.length)
              attributes += ` stroke-dasharray="${item.stroke.dash.map(n).join(" ")}"`;
            if (item.stroke.cap) attributes += ` stroke-linecap="${item.stroke.cap}"`;
            if (item.stroke.join) attributes += ` stroke-linejoin="${item.stroke.join}"`;
          }
          out += `<path d="${pathData(item.commands)}"${attributes}/>`;
          break;
        }
        case "text": {
          const font = item.font;
          if (hasOutlines(font)) {
            // Glyphs are drawn as shapes, so the preview matches the PDF exactly and needs no
            // fonts installed. Font units have y pointing up, hence the negative scale.
            const scale = item.size / font.unitsPerEm;
            let uses = "";
            let pen = 0;
            for (const glyph of item.glyphs) {
              const x = pen + glyph.xOffset;
              uses += `<use href="#${this.glyph(font, glyph.id)}"${x !== 0 ? ` x="${n(x)}"` : ""}${glyph.yOffset !== 0 ? ` y="${n(glyph.yOffset)}"` : ""}/>`;
              pen += glyph.xAdvance;
            }
            // The scale is tiny (size ÷ units per em), so it needs more digits than a coordinate.
            const factor = String(Number(scale.toPrecision(9)));
            out += `<g transform="translate(${n(item.x)} ${n(item.y)}) scale(${factor} -${factor})" fill="${css(item.color)}">${uses}</g>`;
          } else if (font instanceof StandardFont) {
            let width = 0;
            for (const glyph of item.glyphs) width += glyph.xAdvance;
            width = (width * item.size) / font.unitsPerEm;
            const stretch =
              width > 0 ? ` textLength="${n(width)}" lengthAdjust="spacingAndGlyphs"` : "";
            out += `<text x="${n(item.x)}" y="${n(item.y)}" ${standardFontCss(font)} font-size="${n(item.size)}" fill="${css(item.color)}"${stretch} xml:space="preserve">${escapeXml(item.text)}</text>`;
          }
          break;
        }
        case "image": {
          let clip = "";
          if (item.clip) {
            const id = `c${++this.#clips}`;
            this.defs.push(
              `<clipPath id="${id}"><rect x="${n(item.clip.x)}" y="${n(item.clip.y)}" width="${n(item.clip.width)}" height="${n(item.clip.height)}"/></clipPath>`,
            );
            clip = ` clip-path="url(#${id})"`;
          }
          out += `<image x="${n(item.x)}" y="${n(item.y)}" width="${n(item.width)}" height="${n(item.height)}" preserveAspectRatio="none" href="${imageUri(item.image)}"${clip}/>`;
          break;
        }
        case "link": {
          const href = item.url !== undefined ? safeUrl(item.url) : `#${item.target}`;
          if (href === undefined) break;
          out += `<a href="${escapeXml(href)}"><rect x="${n(item.x)}" y="${n(item.y)}" width="${n(item.width)}" height="${n(item.height)}" fill="none" pointer-events="all"/></a>`;
          break;
        }
        case "anchor":
          // An empty, invisible target for links within the document.
          out += `<g id="${escapeXml(item.id)}" transform="translate(${n(item.x)} ${n(item.y)})"/>`;
          break;
        case "heading":
          break;
        case "group": {
          const opacity = item.opacity !== undefined ? ` opacity="${n(item.opacity)}"` : "";
          const rotate = item.rotate
            ? ` transform="rotate(${n(item.rotate.degrees)} ${n(item.rotate.cx)} ${n(item.rotate.cy)})"`
            : "";
          out += `<g${opacity}${rotate}>${this.items(item.items)}</g>`;
          break;
        }
      }
    }
    return out;
  }
}

/** Draws one laid-out page as an SVG document. */
export function pageToSvg(page: DisplayPage): string {
  const writer = new PageWriter();
  const body = writer.items(page.items);
  const defs = writer.defs.length > 0 ? `<defs>${writer.defs.join("")}</defs>` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(page.width)}pt" height="${n(page.height)}pt" ` +
    `viewBox="0 0 ${n(page.width)} ${n(page.height)}">` +
    `<rect width="${n(page.width)}" height="${n(page.height)}" fill="white"/>${defs}${body}</svg>`
  );
}

/**
 * Lays out a document and returns one SVG image per page. The pages are the same as the PDF's:
 * the same line breaks, the same page breaks, the same positions.
 *
 * Text in embedded fonts is drawn as shapes. Text in the 14 standard fonts, which have no
 * shapes to draw, uses the viewer's closest font and may differ slightly.
 */
export function renderSvg(document: LayoutNode | DocumentLayout): string[] {
  const layout = "pages" in document ? document : layoutDocument(document);
  return layout.pages.map(pageToSvg);
}

/** A clickable area of a preview page. Positions are in points from the page's top-left corner. */
export interface PreviewLink {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** A web, mail or phone address, or… */
  readonly url?: string;
  /** …the id of an anchor somewhere in the document. */
  readonly target?: string;
}

/** A place in the document that links point to. */
export interface PreviewAnchor {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

/** One page of a document, prepared for showing on screen. */
export interface PreviewPage {
  /** The page's size in points. */
  readonly width: number;
  readonly height: number;
  /** The page as an SVG image. Made on first use and kept, so unseen pages cost nothing. */
  svg(): string;
  readonly links: readonly PreviewLink[];
  readonly anchors: readonly PreviewAnchor[];
}

type Point = readonly [number, number];
type Transform = (point: Point) => Point;

function collectAreas(
  items: readonly DisplayItem[],
  transform: Transform,
  links: PreviewLink[],
  anchors: PreviewAnchor[],
): void {
  for (const item of items) {
    if (item.type === "link") {
      const url = item.url !== undefined ? safeUrl(item.url) : undefined;
      if (url === undefined && item.target === undefined) continue;
      // Inside a rotated group the area is no longer upright; its bounding box stands in.
      const corners = [
        transform([item.x, item.y]),
        transform([item.x + item.width, item.y]),
        transform([item.x, item.y + item.height]),
        transform([item.x + item.width, item.y + item.height]),
      ];
      const xs = corners.map((corner) => corner[0]);
      const ys = corners.map((corner) => corner[1]);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      links.push({
        x,
        y,
        width: Math.max(...xs) - x,
        height: Math.max(...ys) - y,
        ...(url !== undefined ? { url } : { target: item.target as string }),
      });
    } else if (item.type === "anchor") {
      const [x, y] = transform([item.x, item.y]);
      anchors.push({ id: item.id, x, y });
    } else if (item.type === "group") {
      let inner = transform;
      if (item.rotate) {
        const { degrees, cx, cy } = item.rotate;
        const cos = Math.cos((degrees * Math.PI) / 180);
        const sin = Math.sin((degrees * Math.PI) / 180);
        inner = ([px, py]) =>
          transform([
            cx + (px - cx) * cos - (py - cy) * sin,
            cy + (px - cx) * sin + (py - cy) * cos,
          ]);
      }
      collectAreas(item.items, inner, links, anchors);
    }
  }
}

/**
 * Lays out a document and prepares its pages for an on-screen preview: each page's SVG image
 * (made when first asked for), and its links and anchors as plain rectangles and points, so a
 * viewer can show the image safely as a picture and put real links on top of it.
 *
 * This is what the `@mbingpdf/react` and `@mbingpdf/vue` preview components are built on.
 */
export function previewPages(
  document: LayoutNode | DocumentLayout,
  options: { debug?: boolean } = {},
): PreviewPage[] {
  const layout = "pages" in document ? document : layoutDocument(document, options);
  return layout.pages.map((page) => {
    const links: PreviewLink[] = [];
    const anchors: PreviewAnchor[] = [];
    collectAreas(page.items, (point) => point, links, anchors);
    let svg: string | undefined;
    return {
      width: page.width,
      height: page.height,
      svg: () => {
        svg ??= pageToSvg(page);
        return svg;
      },
      links,
      anchors,
    };
  });
}
