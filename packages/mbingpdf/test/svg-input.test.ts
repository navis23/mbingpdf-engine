import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { Document, layoutDocument, Page, Row, render, Svg, Text } from "../src/index.ts";
import { parsePathData, parseSvg } from "../src/layout/svg-input.ts";
import { type PathItem, pathBounds } from "./harness/geometry.ts";
import { decodePng, type RenderedPage, renderPdf } from "./harness/render.ts";

const hasRsvg = spawnSync("rsvg-convert", ["--version"]).status === 0;
const svg = (body: string, attributes = 'viewBox="0 0 200 120"'): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${attributes}>${body}</svg>`;

/** Renders an SVG with librsvg at a given size, on white. */
function reference(markup: string, width: number, height: number): RenderedPage {
  const dir = mkdtempSync(join(tmpdir(), "mbingpdf-"));
  try {
    const input = join(dir, "in.svg");
    const output = join(dir, "out.png");
    writeFileSync(input, markup);
    spawnSync("rsvg-convert", [
      "-w",
      String(width),
      "-h",
      String(height),
      "-b",
      "white",
      "-o",
      output,
      input,
    ]);
    return decodePng(new Uint8Array(readFileSync(output)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Renders the same SVG through the document API and a PDF engine. */
async function ours(markup: string, width: number, height: number): Promise<RenderedPage> {
  const pdf = await render(
    Document(Page({ size: [width, height], margin: 0 }, Svg({ src: markup, width, height }))),
    { deterministic: true },
  );
  const [page] = await renderPdf("pdfium", pdf, 2);
  return page as RenderedPage;
}

function meanDifference(a: RenderedPage, b: RenderedPage): number {
  let total = 0;
  for (let i = 0; i < a.pixels.length; i++) {
    if (i % 4 !== 3) total += Math.abs((a.pixels[i] as number) - (b.pixels[i] as number));
  }
  return total / ((a.pixels.length / 4) * 3);
}

const DRAWINGS: [string, string][] = [
  [
    "basic shapes",
    svg(
      '<rect x="10" y="10" width="60" height="40" fill="#e63946"/>' +
        '<rect x="80" y="10" width="60" height="40" rx="12" fill="steelblue" stroke="navy" stroke-width="3"/>' +
        '<circle cx="40" cy="85" r="25" fill="gold"/>' +
        '<ellipse cx="110" cy="85" rx="30" ry="18" fill="none" stroke="#2a9d8f" stroke-width="4"/>' +
        '<line x1="150" y1="10" x2="190" y2="110" stroke="black" stroke-width="2"/>' +
        '<polygon points="150,60 190,60 170,25" fill="purple"/>' +
        '<polyline points="150,75 165,110 180,75 195,110" fill="none" stroke="tomato" stroke-width="3"/>',
    ),
  ],
  [
    "every path command",
    svg(
      '<path d="M10 20 L50 20 l0 30 H10 v-30 z" fill="#457b9d"/>' +
        '<path d="M70 50 C70 10 110 10 110 50 S150 90 150 50" fill="none" stroke="#e76f51" stroke-width="4"/>' +
        '<path d="M10 100 Q30 60 50 100 T90 100 t40 0" fill="none" stroke="#2a9d8f" stroke-width="4"/>' +
        '<path d="M150 80 a20 20 0 1 0 40 0 a20 12 30 0 1 -40 0" fill="#f4a261" stroke="black"/>' +
        '<path d="M160,20A15,25,0,0,1,190,20Z" fill="crimson"/>',
    ),
  ],
  [
    "arcs with large-arc and sweep flags, and compact flag syntax",
    svg(
      '<path d="M40 60 A30 30 0 0 0 100 60" fill="none" stroke="red" stroke-width="4"/>' +
        '<path d="M40 60 A30 30 0 0 1 100 60" fill="none" stroke="blue" stroke-width="4"/>' +
        '<path d="M120 40 A20 30 45 1 1 160 80" fill="none" stroke="green" stroke-width="4"/>' +
        '<path d="M120 40 A20 30 45 1 0 160 80" fill="none" stroke="orange" stroke-width="4"/>' +
        '<path d="M10 100a8 8 0 01 16 0a8 8 0 01-16 0z" fill="teal"/>',
    ),
  ],
  [
    "groups and transforms",
    svg(
      '<g transform="translate(40 40)"><rect x="-20" y="-20" width="40" height="40" fill="#264653"/>' +
        '<g transform="rotate(45)"><rect x="-10" y="-10" width="20" height="20" fill="#e9c46a"/></g></g>' +
        '<g transform="translate(120,30) scale(2 1)"><circle cx="10" cy="10" r="10" fill="#e76f51"/></g>' +
        '<rect x="0" y="0" width="30" height="15" fill="#2a9d8f" transform="matrix(1 0.3 -0.3 1 90 80)"/>' +
        '<rect width="30" height="15" fill="indigo" transform="translate(150 90) skewX(30)"/>' +
        '<rect width="20" height="20" fill="brown" transform="rotate(30 20 100) translate(10 90)"/>',
    ),
  ],
  [
    "strokes: caps, joins and dashes",
    svg(
      '<path d="M20 20 L60 20" stroke="black" stroke-width="10" stroke-linecap="butt"/>' +
        '<path d="M20 45 L60 45" stroke="black" stroke-width="10" stroke-linecap="round"/>' +
        '<path d="M20 70 L60 70" stroke="black" stroke-width="10" stroke-linecap="square"/>' +
        '<path d="M90 60 L110 20 L130 60" fill="none" stroke="#1d3557" stroke-width="8" stroke-linejoin="round"/>' +
        '<path d="M140 60 L160 20 L180 60" fill="none" stroke="#1d3557" stroke-width="8" stroke-linejoin="bevel"/>' +
        '<path d="M20 100 H180" stroke="#e63946" stroke-width="4" stroke-dasharray="12 6 2 6"/>',
    ),
  ],
  [
    "inherited style, the style attribute, and opacity",
    svg(
      '<g fill="#2a9d8f" stroke="#264653" stroke-width="2">' +
        '<rect x="10" y="10" width="40" height="40"/>' +
        '<rect x="60" y="10" width="40" height="40" style="fill: #e9c46a; stroke: none"/>' +
        '<rect x="110" y="10" width="40" height="40" fill="none"/></g>' +
        '<rect x="20" y="60" width="80" height="40" fill="blue"/>' +
        '<rect x="60" y="70" width="80" height="40" fill="red" opacity="0.5"/>' +
        '<circle cx="165" cy="85" r="22" fill="green" fill-opacity="0.3" stroke="green" stroke-width="5"/>',
    ),
  ],
  [
    "even-odd fill, reused shapes and hidden elements",
    svg(
      '<defs><circle id="dot" cx="0" cy="0" r="8" fill="#e63946"/></defs>' +
        '<path d="M20 20 H100 V100 H20 Z M40 40 H80 V80 H40 Z" fill="#1d3557" fill-rule="evenodd"/>' +
        '<path d="M110 20 H190 V100 H110 Z M130 40 H170 V80 H130 Z" fill="#457b9d"/>' +
        '<use xlink:href="#dot" x="60" y="60"/><use href="#dot" x="150" y="60" transform="scale(1)"/>' +
        '<rect x="0" y="0" width="200" height="120" fill="black" display="none"/>',
    ),
  ],
  [
    "a viewBox that does not start at the origin",
    svg(
      '<rect x="100" y="50" width="100" height="60" fill="#f4a261"/><circle cx="150" cy="80" r="20" fill="white"/>',
      'viewBox="100 50 100 60"',
    ),
  ],
];

describe("SVG input", () => {
  test.skipIf(!hasRsvg).each(DRAWINGS)("draws as librsvg does: %s", async (_name, markup) => {
    const drawing = parseSvg(markup);
    const width = 200;
    const height = Math.round((200 * drawing.height) / drawing.width);
    const expected = reference(markup, width * 2, height * 2);
    const actual = await ours(markup, width, height);
    expect([actual.width, actual.height]).toEqual([expected.width, expected.height]);
    // Different rasterisers disagree along edges; a misplaced or missing shape moves the
    // average far more than this.
    expect(meanDifference(actual, expected)).toBeLessThan(2);
  });

  test("path data: relative and shorthand commands become absolute lines and curves", () => {
    expect(parsePathData("M10 20 l5 5 h10 v-5 z")).toEqual([
      ["M", 10, 20],
      ["L", 15, 25],
      ["L", 25, 25],
      ["L", 25, 20],
      ["Z"],
    ]);
    // Numbers may run together, and a command letter repeats implicitly.
    expect(parsePathData("M0,0L10-5.5.5.5 20 20")).toEqual([
      ["M", 0, 0],
      ["L", 10, -5.5],
      ["L", 0.5, 0.5],
      ["L", 20, 20],
    ]);
    expect(parsePathData("M 0 0 10 0 10 10")).toEqual([
      ["M", 0, 0],
      ["L", 10, 0],
      ["L", 10, 10],
    ]);
    expect(parsePathData("")).toEqual([]);
    expect(parsePathData("M 1 2 X 3")).toEqual([["M", 1, 2]]);
  });

  test("sizes like an image and sits in the layout", () => {
    const markup = svg('<rect width="200" height="120" fill="red"/>');
    const box = (props: object) => {
      const page = layoutDocument(
        Document(
          Page({ size: [300, 300], margin: 10 }, Svg({ src: markup, ...props }), Text("di bawah")),
        ),
      ).pages[0];
      const path = page?.items.find((item): item is PathItem => item.type === "path");
      return {
        ...pathBounds(path as PathItem),
        text: page?.items.find((item) => item.type === "text"),
      };
    };
    // 200 × 120 CSS pixels is 150 × 90 points.
    expect(box({})).toMatchObject({ x: 10, y: 10, width: 150, height: 90 });
    expect(box({ width: 100 })).toMatchObject({ width: 100, height: 60 });
    expect(box({ height: 30 })).toMatchObject({ width: 50, height: 30 });
    // Given both, the drawing keeps its shape and is centred.
    expect(box({ width: 100, height: 100 })).toMatchObject({
      x: 10,
      y: 30,
      width: 100,
      height: 60,
    });
    expect((box({ width: 100 }).text as { y: number }).y).toBeGreaterThan(70);
  });

  test("currentColor takes the text colour", () => {
    const markup = svg('<circle cx="100" cy="60" r="50" fill="currentColor"/>');
    const page = layoutDocument(
      Document({ color: "#ff0000" }, Page({ size: [300, 300], margin: 10 }, Svg({ src: markup }))),
    ).pages[0];
    expect(page?.items[0]).toMatchObject({ type: "path", fill: { r: 1, g: 0, b: 0 } });
  });

  test("is drawn as shapes, not as an image, and accepts bytes", async () => {
    const bytes = new TextEncoder().encode(svg('<rect width="200" height="120" fill="#123456"/>'));
    const pdf = await render(
      Document(Page({ size: [300, 300], margin: 10 }, Row(Svg({ src: bytes, width: 50 })))),
      {
        deterministic: true,
        compress: false,
      },
    );
    const out = new TextDecoder("latin1").decode(pdf);
    expect(out).not.toContain("/Subtype/Image");
    expect(out).toContain("0.071 0.204 0.337 rg");
  });

  test("rejects what is not a usable SVG", () => {
    expect(() => parseSvg("<html></html>")).toThrow(/no <svg> element/);
    expect(() => parseSvg("<svg></svg>")).toThrow(/has no size/);
    // Unsupported paints fall back rather than fail.
    const items = parseSvg(svg('<rect width="10" height="10" fill="url(#gradient)"/>')).items({
      space: "gray",
      gray: 0,
    });
    expect(items).toHaveLength(1);
  });
});
