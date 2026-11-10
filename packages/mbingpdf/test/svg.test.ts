import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { describe, expect, test } from "vitest";
import { type PdfImage, StandardFonts } from "../src/core/index.ts";
import { decodePng } from "../src/image/index.ts";
import {
  Absolute,
  Box,
  Canvas,
  Document,
  Font,
  Image,
  Link,
  layoutDocument,
  mm,
  Page,
  Row,
  render,
  Span,
  Stack,
  Text,
} from "../src/index.ts";
import { renderSvg } from "../src/svg/index.ts";
import { encodePng } from "../src/svg/png.ts";
import { env } from "./harness/env.ts";
import { type RenderedPage, renderPdf } from "./harness/render.ts";

const hasMagick = spawnSync("magick", ["-version"]).status === 0;
const inter = new Font(env.fonts["Inter-Variable"]);
const sourceSans = new Font(env.fonts["SourceSans3-Regular"]);

const sampleDocument = () =>
  Document(
    { font: inter, size: 11 },
    Page(
      {
        size: "A6",
        margin: mm(8),
        gap: 8,
        footer: ({ page, pages }) => Text({ size: 7, align: "center" }, `${page}/${pages}`),
      },
      Row(
        { gap: 8 },
        Image({ src: env.photo, width: 60 }),
        Stack(
          { grow: 1 },
          Text({ font: inter.instance("Bold"), size: 16 }, "Pratinjau SVG"),
          Text(
            "AVATAR office — é ",
            Link({ href: "https://example.com/?a=1&b=2", color: "#1d4ed8" }, "tautan"),
          ),
        ),
      ),
      Box(
        { background: "#eef2ff", border: { width: 1, color: "#6366f1" }, radius: 6, padding: 8 },
        Text("Kotak dengan ", Span({ color: "#b91c1c" }, "warna"), " dan sudut bulat."),
      ),
      Text({ font: sourceSans, size: 14 }, "Fon CFF: Sertifikat & <Penghargaan>"),
      Canvas({
        width: "100%",
        height: 40,
        draw: (g, { width, height }) => {
          g.roundedRect(0, 0, width, height, 4).fillAndStroke("#fde68a", {
            color: "#b45309",
            dash: [4, 2],
          });
          g.circle(width / 2, height / 2, 12).fill("#2563eb");
        },
      }),
      Image({ src: env.photo, width: 50, height: 50, fit: "cover" }),
      Absolute({ top: 200, left: 40, rotate: -20, opacity: 0.2 }, Text({ size: 40 }, "CONTOH")),
    ),
  );

/** Rasterises an SVG with the canvas library's own renderer. */
async function rasterize(svg: string, width: number, height: number): Promise<RenderedPage> {
  const image = await loadImage(Buffer.from(svg));
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return {
    width,
    height,
    pixels: new Uint8Array(context.getImageData(0, 0, width, height).data.buffer.slice(0)),
  };
}

/** Mean difference per colour channel between two images of the same size, 0–255. */
function meanDifference(a: RenderedPage, b: RenderedPage): number {
  let total = 0;
  for (let i = 0; i < a.pixels.length; i++) {
    if (i % 4 !== 3) total += Math.abs((a.pixels[i] as number) - (b.pixels[i] as number));
  }
  return total / ((a.pixels.length / 4) * 3);
}

describe("SVG backend", () => {
  test("gives one SVG per page, the size of the page", () => {
    const pages = renderSvg(
      Document(
        Page({ size: [200, 100], margin: 10 }, Text("satu")),
        Page({ size: "A5" }, Text("dua")),
      ),
    );
    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatch(
      /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="200pt" height="100pt" viewBox="0 0 200 100">/,
    );
    expect(pages[1]).toContain('viewBox="0 0 419.528 595.276"');
    expect(pages[0]?.endsWith("</svg>")).toBe(true);
  });

  test("accepts a layout that was already computed", () => {
    const layout = layoutDocument(sampleDocument());
    expect(renderSvg(layout)).toEqual(renderSvg(sampleDocument()));
  });

  test("draws embedded fonts as shapes, each glyph defined once", () => {
    const [svg] = renderSvg(sampleDocument());
    expect(svg).toBeDefined();
    if (!svg) return;
    // No <text> elements: nothing depends on fonts installed where the SVG is shown.
    expect(svg).not.toContain("<text");
    const ids = [...svg.matchAll(/<path id="(f\d+g\d+)"/g)].map((match) => match[1]);
    expect(ids.length).toBeGreaterThan(30);
    expect(new Set(ids).size).toBe(ids.length);
    for (const use of svg.matchAll(/<use href="#(f\d+g\d+)"/g)) expect(ids).toContain(use[1]);
    // Inter has 2048 units per em: an 11-point glyph is scaled by 11/2048.
    expect(svg).toContain(
      `scale(${Number((11 / 2048).toPrecision(9))} -${Number((11 / 2048).toPrecision(9))})`,
    );
  });

  test("standard fonts fall back to text in a similar font", () => {
    const [svg] = renderSvg(
      Document(
        Page(
          { size: [300, 100], margin: 10 },
          Text({ font: StandardFonts.TimesBoldItalic, size: 12 }, "Tom & <Jerry>"),
          Text({ font: StandardFonts.Courier }, "kode"),
        ),
      ),
    );
    expect(svg).toContain(
      `font-family="'Times New Roman',Times,serif" font-weight="bold" font-style="italic" font-size="12"`,
    );
    expect(svg).toContain(">Tom &amp; &lt;Jerry&gt;</text>");
    expect(svg).toContain(`font-family="'Courier New',Courier,monospace"`);
    expect(svg).toMatch(/textLength="[\d.]+" lengthAdjust="spacingAndGlyphs"/);
  });

  test("links, images, clipping, rotation and opacity", () => {
    const [svg] = renderSvg(sampleDocument());
    expect(svg).toContain('<a href="https://example.com/?a=1&amp;b=2"><rect ');
    expect(svg).toContain('href="data:image/jpeg;base64,/9j/');
    expect(svg).toMatch(/<clipPath id="c1"><rect [^>]*width="50" height="50"\/><\/clipPath>/);
    expect(svg).toContain('clip-path="url(#c1)"');
    expect(svg).toMatch(/<g opacity="0\.2" transform="rotate\(-20 [\d.]+ [\d.]+\)">/);
    expect(svg).toContain('stroke-dasharray="4 2"');
  });

  test("looks like the PDF of the same document", async () => {
    const document = sampleDocument();
    const [svg] = renderSvg(document);
    const [pdfPage] = await renderPdf("pdfium", await render(document, { deterministic: true }), 2);
    expect(svg).toBeDefined();
    expect(pdfPage).toBeDefined();
    if (!svg || !pdfPage) return;
    const svgPage = await rasterize(svg, pdfPage.width, pdfPage.height);
    // Two different rasterisers never agree to the pixel; what matters is that nothing is
    // missing or out of place, which would move the average by far more than this.
    expect(meanDifference(svgPage, pdfPage)).toBeLessThan(2.5);
    // And it is not a blank page.
    const blank: RenderedPage = {
      ...pdfPage,
      pixels: new Uint8Array(pdfPage.pixels.length).fill(255),
    };
    expect(meanDifference(pdfPage, blank)).toBeGreaterThan(8);
  });
});

describe("PNG encoding for SVG images", () => {
  const suite = readdirSync(new URL("./images/pngsuite/", import.meta.url)).filter(
    (name) => name.endsWith(".png") && !name.startsWith("x"),
  );

  /**
   * RGBA pixels of a PNG file as ImageMagick decodes it, with the stored sample values taken
   * as they are (PngSuite's files declare a gamma that would otherwise be applied).
   */
  function pixels(file: Uint8Array): Uint8Array {
    const dir = mkdtempSync(join(tmpdir(), "mbingpdf-"));
    try {
      const path = join(dir, "image.png");
      writeFileSync(path, file);
      const raw = spawnSync(
        "magick",
        [
          "-define",
          "png:ignore-gamma=true",
          path,
          "-set",
          "colorspace",
          "sRGB",
          "-depth",
          "8",
          "rgba:-",
        ],
        { maxBuffer: 64 * 1024 * 1024 },
      );
      return new Uint8Array(raw.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test.skipIf(!hasMagick)("every PngSuite image survives decoding and re-encoding", () => {
    const failures: string[] = [];
    for (const name of suite) {
      const original = new Uint8Array(
        readFileSync(new URL(`./images/pngsuite/${name}`, import.meta.url)),
      );
      const decoded: PdfImage = decodePng(original);
      const encoded = encodePng(decoded);
      const want = pixels(original);
      const got = pixels(encoded);
      if (want.length !== got.length) {
        failures.push(`${name}: size changed`);
        continue;
      }
      let worst = 0;
      for (let i = 0; i < want.length; i++) {
        // Fully transparent pixels have no meaningful colour.
        if (i % 4 !== 3 && want[i - (i % 4) + 3] === 0) continue;
        worst = Math.max(worst, Math.abs((want[i] as number) - (got[i] as number)));
      }
      // 16-bit images with transparency are written with 8 bits per channel.
      if (worst > 1) failures.push(`${name}: differs by ${worst}`);
    }
    expect(failures).toEqual([]);
  });
});
