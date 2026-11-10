import { readFileSync } from "node:fs";
import * as hb from "harfbuzzjs";
import { describe, expect, test } from "vitest";
import { PdfDocument } from "../src/core/index.ts";
import { subsetCff } from "../src/font/cff.ts";
import { Font } from "../src/font/index.ts";
import { buildSfnt, parseSfnt } from "../src/font/sfnt.ts";
import { layoutParagraph } from "../src/text/index.ts";
import { encodePng, extractText, renderPdf } from "./harness/render.ts";

const bytes = new Uint8Array(
  readFileSync(new URL("./fonts/SourceSans3-Regular.otf", import.meta.url)),
);
const font = new Font(bytes);
const reference = new hb.Font(new hb.Face(new hb.Blob(bytes.slice().buffer)));

/** Wraps a bare CFF subset in an OpenType file so that HarfBuzz can read its outlines. */
function asOpenType(cff: Uint8Array, glyphs: readonly number[]): hb.Font {
  const source = parseSfnt(bytes).tables;
  const patch = (tag: string, offset: number, value: number): Uint8Array => {
    const table = (source.get(tag) as Uint8Array).slice();
    new DataView(table.buffer).setUint16(offset, value);
    return table;
  };
  const hmtx = new Uint8Array(glyphs.length * 4);
  const view = new DataView(hmtx.buffer);
  glyphs.forEach((glyph, i) => {
    view.setUint16(i * 4, font.advanceWidth(glyph));
  });
  const head = (source.get("head") as Uint8Array).slice();
  new DataView(head.buffer).setUint32(8, 0);
  const file = buildSfnt(
    new Map([
      ["CFF ", cff],
      ["head", head],
      ["hhea", patch("hhea", 34, glyphs.length)],
      ["hmtx", hmtx],
      ["maxp", patch("maxp", 4, glyphs.length)],
    ]),
    0x4f54544f,
  );
  return new hb.Font(new hb.Face(new hb.Blob(file.slice().buffer)));
}

describe("fonts with CFF outlines", () => {
  test("are parsed like any other font", () => {
    expect(font.outlines).toBe("cff");
    expect(font.postScriptName).toBe("SourceSans3-Regular");
    expect(font.familyName).toBe("Source Sans 3");
    expect(font.unitsPerEm).toBe(1000);
    expect(font.axes).toEqual([]);
    expect(() => font.instance({ wght: 700 })).toThrow(/not a variable font/);
  });

  test("shaping agrees with HarfBuzz", () => {
    for (const text of [
      "AVATAR Tokyo, WAVE. Yes!",
      "office fjord ffi 1/2 — “Rp 1.250.000”",
      "Đặng Thị Ánh q̃",
    ]) {
      const buffer = new hb.Buffer();
      buffer.addText(text);
      buffer.guessSegmentProperties();
      hb.shape(reference, buffer);
      const positions = buffer.getGlyphPositions();
      const want = buffer
        .getGlyphInfos()
        .map((info, i) => [
          info.codepoint,
          positions[i]?.xAdvance,
          positions[i]?.xOffset,
          positions[i]?.yOffset,
        ]);
      expect(
        font.shape(text).map((g) => [g.id, g.xAdvance, g.xOffset, g.yOffset]),
        text,
      ).toEqual(want);
    }
  });

  test("a subset keeps the outlines of exactly the glyphs asked for", () => {
    const glyphs = [0, ...new Set(font.shape("Halo, dunia — é ß fi Ánh").map((glyph) => glyph.id))];
    const subset = font.subset(glyphs);
    expect(subset.format).toBe("cff");
    expect(subset.glyphs).toEqual(glyphs);
    expect(subset.data.length).toBeLessThan(bytes.length / 4);
    const rebuilt = asOpenType(subset.data, glyphs);
    glyphs.forEach((glyph, i) => {
      expect(rebuilt.glyphToPath(i), `outline of glyph ${glyph}`).toBe(
        reference.glyphToPath(glyph),
      );
    });
  });

  test("every glyph survives a subset of the whole font, and a subset of that subset", () => {
    const all = Array.from({ length: font.numGlyphs }, (_, i) => i);
    const first = subsetCff(font.table("CFF ") as Uint8Array, all);
    // The first subset is CID-keyed, so subsetting it again exercises the CID-keyed reader.
    const picked = [0, 5, 40, 41, 300, 301, 1200, font.numGlyphs - 1];
    const second = subsetCff(first, picked);
    const rebuilt = asOpenType(second, picked);
    picked.forEach((glyph, i) => {
      expect(rebuilt.glyphToPath(i), `outline of glyph ${glyph}`).toBe(
        reference.glyphToPath(glyph),
      );
    });
    const whole = asOpenType(first, all);
    for (const glyph of [0, 1, 100, 1000, font.numGlyphs - 1]) {
      expect(whole.glyphToPath(glyph)).toBe(reference.glyphToPath(glyph));
    }
  });

  test("a repeated glyph is stored twice", () => {
    const a = font.glyphForCodePoint(0x41);
    const rebuilt = asOpenType(font.subset([0, a, a]).data, [0, a, a]);
    expect(rebuilt.glyphToPath(2)).toBe(reference.glyphToPath(a));
  });

  test("embeds as a CID-keyed CFF font that renders and reads back", async () => {
    const doc = new PdfDocument({ xref: "table", compress: false, deterministic: true });
    const layout = layoutParagraph("Sertifikat Penghargaan — AVATAR office é", { font, size: 16 });
    const page = doc.addPage({ size: [320, 60] });
    page.content.font(font, 16).text("Sertifikat Penghargaan — AVATAR office é", 10, 25);
    const pdf = doc.finish();
    const out = new TextDecoder("latin1").decode(pdf);
    expect(out).toMatch(/\/Subtype\/CIDFontType0\/BaseFont\/[A-Z]{6}\+SourceSans3-Regular/);
    expect(out).toContain("/Subtype/CIDFontType0C");
    expect(out).toContain("/FontFile3 ");
    expect(out).not.toContain("/CIDToGIDMap");
    expect(out).not.toContain("/FontFile2");
    expect((await extractText(pdf))[0]?.join("")).toBe("Sertifikat Penghargaan — AVATAR office é");

    // Both engines must actually draw the glyphs: ink should cover the measured width.
    for (const renderer of ["pdfjs", "pdfium"] as const) {
      const [image] = await renderPdf(renderer, pdf);
      expect(image).toBeDefined();
      if (!image) continue;
      let left = image.width;
      let right = 0;
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          if ((image.pixels[(y * image.width + x) * 4] as number) < 128) {
            left = Math.min(left, x);
            right = Math.max(right, x);
          }
        }
      }
      expect(encodePng(image).length).toBeGreaterThan(500);
      const scale = image.width / 320;
      expect(left / scale, renderer).toBeGreaterThan(8);
      expect(left / scale, renderer).toBeLessThan(14);
      expect(right / scale, renderer).toBeGreaterThan(10 + layout.width - 4);
      expect(right / scale, renderer).toBeLessThan(10 + layout.width + 2);
    }
  });
});
