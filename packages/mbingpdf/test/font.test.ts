import { readFileSync } from "node:fs";
import * as hb from "harfbuzzjs";
import { describe, expect, test } from "vitest";
import { PdfDocument } from "../src/core/index.ts";
import { TrueTypeFont } from "../src/font/index.ts";
import { parseSfnt } from "../src/font/sfnt.ts";
import { readFont } from "./harness/env.ts";
import { extractText } from "./harness/render.ts";
import { FONT_FILES, type FontFile } from "./harness/samples.ts";

const latin1 = (bytes: Uint8Array): string => new TextDecoder("latin1").decode(bytes);
const load = (file: FontFile): TrueTypeFont => new TrueTypeFont(readFont(file));

/** A string that exercises ASCII, Latin-1, Latin Extended, punctuation and a missing glyph. */
const CORPUS = "The quick brown fox — “Rp 1.250.000” éüŵßÅØĐ fi ffl 0123456789 →€™ 日";

function harfbuzzFont(file: FontFile): hb.Font {
  return new hb.Font(new hb.Face(new hb.Blob(readFont(file).slice().buffer)));
}

describe("TrueTypeFont", () => {
  test("reads names and global metrics", () => {
    const inter = load("Inter-Variable");
    expect(inter.postScriptName).toBe("Inter-Regular");
    expect(inter.familyName).toBe("Inter");
    expect(inter.subfamilyName).toBe("Regular");
    expect(inter.unitsPerEm).toBe(2048);
    expect(inter.weightClass).toBe(400);
    expect(inter.isFixedPitch).toBe(false);
    expect(inter.isItalic).toBe(false);
    expect(inter.embeddable).toBe(true);

    const mono = load("JetBrainsMono-Variable");
    expect(mono.familyName).toBe("JetBrains Mono");
    expect(mono.isFixedPitch).toBe(true);
    expect(mono.widthOfText("iiii", 10)).toBe(mono.widthOfText("WWWW", 10));

    const bold = load("BarlowCondensed-Bold");
    expect(bold.postScriptName).toBe("BarlowCondensed-Bold");
    expect(bold.weightClass).toBe(700);
    expect(bold.capHeight).toBe(700);
    expect(bold.ascent(10)).toBe(10);
    expect(bold.descent(10)).toBe(2);
  });

  test.each(FONT_FILES)("glyph mapping and advances agree with HarfBuzz: %s", (file) => {
    const font = load(file);
    const reference = harfbuzzFont(file);
    expect(font.unitsPerEm).toBe(reference.face.upem);
    const buffer = new hb.Buffer();
    buffer.addText(CORPUS);
    buffer.guessSegmentProperties();
    // Switch off every substitution and positioning feature: this compares cmap and hmtx only.
    hb.shape(
      reference,
      buffer,
      ["kern", "liga", "clig", "calt", "ccmp", "locl", "mark", "mkmk", "rlig", "dlig"].map(
        (tag) => new hb.Feature(tag, 0),
      ),
    );
    const infos = buffer.getGlyphInfos();
    const positions = buffer.getGlyphPositions();
    const chars = [...CORPUS];
    expect(infos.length).toBe(chars.length);
    chars.forEach((char, i) => {
      const glyph = font.glyphForCodePoint(char.codePointAt(0) as number);
      expect(glyph, `glyph for ${char}`).toBe(infos[i]?.codepoint);
      expect(font.advanceWidth(glyph), `advance of ${char}`).toBe(positions[i]?.xAdvance);
    });
  });

  test("reports missing glyphs", () => {
    const font = load("BarlowCondensed-Regular");
    expect(font.glyphForCodePoint(0x65e5)).toBe(0);
    expect(font.hasGlyphsFor("Halo dunia")).toBe(true);
    expect(font.hasGlyphsFor("日本")).toBe(false);
    expect(font.advanceWidth(999_999)).toBe(0);
  });

  test("accepts a Node Buffer without corrupting it", () => {
    const buffer = readFileSync(new URL("./fonts/BarlowCondensed-Regular.ttf", import.meta.url));
    const before = Uint8Array.from(buffer);
    const font = new TrueTypeFont(buffer);
    const fromBuffer = font.subset([0, font.glyphForCodePoint(0xe9)]);
    expect(Uint8Array.from(buffer)).toEqual(before);
    const plain = load("BarlowCondensed-Regular");
    expect(fromBuffer.data).toEqual(plain.subset([0, plain.glyphForCodePoint(0xe9)]).data);
  });

  test("rejects files that are not TrueType fonts", () => {
    expect(() => new TrueTypeFont(new Uint8Array(4))).toThrow(/too short/);
    expect(() => new TrueTypeFont(new TextEncoder().encode("%PDF-1.7 not a font"))).toThrow(
      /unrecognised file signature/,
    );
    expect(() => new TrueTypeFont(new TextEncoder().encode("OTTO\0\0\0\0\0\0\0\0"))).toThrow(/CFF/);
    expect(() => new TrueTypeFont(new TextEncoder().encode("wOF2\0\0\0\0\0\0\0\0"))).toThrow(
      /WOFF2/,
    );
  });
});

describe("subsetting", () => {
  test("keeps only the requested glyphs and the parts they are built from", () => {
    const font = load("BarlowCondensed-Regular");
    const eacute = font.glyphForCodePoint(0xe9);
    const subset = font.subset([0, font.glyphForCodePoint(0x52), eacute]);
    // é is a composite of e and the acute accent, which were not requested.
    expect(subset.glyphs.slice(0, 3)).toEqual([0, font.glyphForCodePoint(0x52), eacute]);
    expect(subset.glyphs.length).toBe(5);
    expect(subset.glyphs).toContain(font.glyphForCodePoint(0x65));
    expect(subset.data.length).toBeLessThan(readFont("BarlowCondensed-Regular").length / 10);

    const tables = parseSfnt(subset.data).tables;
    expect([...tables.keys()]).toEqual([
      "cvt ",
      "fpgm",
      "glyf",
      "head",
      "hhea",
      "hmtx",
      "loca",
      "maxp",
      "prep",
    ]);
    const view = (tag: string): DataView => {
      const table = tables.get(tag) as Uint8Array;
      return new DataView(table.buffer, table.byteOffset, table.byteLength);
    };
    expect(view("maxp").getUint16(4)).toBe(5);
    expect(view("hhea").getUint16(34)).toBe(5);
    expect(view("loca").byteLength).toBe(6 * 4);
    expect(view("hmtx").byteLength).toBe(5 * 4);
    subset.glyphs.forEach((glyph, i) => {
      expect(view("hmtx").getUint16(i * 4)).toBe(font.advanceWidth(glyph));
    });
  });

  test("the subset is itself a font HarfBuzz accepts, with the same outlines", () => {
    for (const file of FONT_FILES) {
      const font = load(file);
      const original = harfbuzzFont(file);
      const wanted = [
        0,
        ...[..."Rpé“ß"].map((c) => font.glyphForCodePoint(c.codePointAt(0) as number)),
      ];
      const subset = font.subset(wanted);
      const reparsed = new hb.Font(new hb.Face(new hb.Blob(subset.data.slice().buffer)));
      subset.glyphs.forEach((glyph, i) => {
        expect(reparsed.glyphHAdvance(i), `${file} advance of glyph ${glyph}`).toBe(
          original.glyphHAdvance(glyph),
        );
        expect(reparsed.glyphToPath(i), `${file} outline of glyph ${glyph}`).toBe(
          original.glyphToPath(glyph),
        );
      });
    }
  });

  test("checksums are valid", () => {
    const data = load("Inter-Variable").subset([0, 5, 6]).data;
    let sum = 0;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let i = 0; i + 4 <= data.length; i += 4) sum = (sum + view.getUint32(i)) >>> 0;
    expect(data.length % 4).toBe(0);
    expect(sum).toBe(0xb1b0afba);
  });

  test("validates its input", () => {
    const font = load("BarlowCondensed-Regular");
    expect(() => font.subset([5, 6])).toThrow(/start with glyph 0/);
    // A repeated glyph is simply stored twice.
    expect(font.subset([0, 5, 5]).glyphs.slice(0, 3)).toEqual([0, 5, 5]);
  });
});

describe("embedding", () => {
  const plain = { xref: "table", compress: false, deterministic: true } as const;

  test("writes a subset CID font with widths and a ToUnicode map", async () => {
    const font = load("BarlowCondensed-Regular");
    const doc = new PdfDocument(plain);
    doc
      .addPage({ size: [300, 100] })
      .content.font(font, 20)
      .text("Halo, dunia — é", 10, 40);
    doc
      .addPage({ size: [300, 100] })
      .content.font(font, 20)
      .text("dua", 10, 40);
    const pdf = doc.finish();
    const out = latin1(pdf);

    expect(out).toMatch(
      /\/Subtype\/Type0\/BaseFont\/[A-Z]{6}\+BarlowCondensed-Regular\/Encoding\/Identity-H/,
    );
    expect(out).toMatch(/\/Subtype\/CIDFontType2\/BaseFont\/[A-Z]{6}\+BarlowCondensed-Regular/);
    expect(out).toContain("/CIDToGIDMap/Identity");
    expect(out).toContain("/FontFile2 ");
    expect(out.match(/\/Subtype\/Type0/g)?.length).toBe(1);
    // Glyphs are numbered in order of first use, after glyph 0:
    // H=1 a=2 l=3 o=4 ,=5 space=6 d=7 u=8 n=9 i=10 —=11 é=12.
    // The font kerns "o," by -7 units, so the text is a TJ array with one adjustment.
    const ids = (...values: number[]): string =>
      values.map((value) => value.toString(16).toUpperCase().padStart(4, "0")).join("");
    expect(out).toContain(`[<${ids(1, 2, 3, 4)}>7<${ids(5, 6, 7, 8, 9, 10, 2, 6, 11, 6, 12)}>] TJ`);
    expect(out).toContain(`<${ids(7, 8, 2)}> Tj`);
    const h = font.advanceWidth(font.glyphForCodePoint(0x48));
    expect(out).toContain(`/W[0[${font.advanceWidth(0)} ${h} `);
    expect(out).toContain("<0001> <0048>\n");
    expect(out).toContain("<000B> <2014>\n");

    expect(await extractText(pdf)).toEqual([["Halo, dunia — é"], ["dua"]]);
  });

  test("ligatures and composed accents map back to the text they stand for", async () => {
    const font = load("BarlowCondensed-Regular");
    const doc = new PdfDocument(plain);
    doc
      .addPage({ size: [300, 100] })
      .content.font(font, 20)
      .text("fi e\u0301 office", 10, 40);
    const pdf = doc.finish();
    const out = latin1(pdf);
    // One glyph for "fi", mapped to both letters; e + combining acute drawn with the é glyph.
    expect(out).toContain("<0001> <00660069>\n");
    expect(out).toContain("<0003> <00650301>\n");
    expect((await extractText(pdf))[0]?.join("").normalize("NFC")).toBe("fi é office");
  });

  test("kerning can be measured and matches what is drawn", () => {
    const font = load("BarlowCondensed-Regular");
    const doc = new PdfDocument(plain);
    doc
      .addPage({ size: [300, 100] })
      .content.font(font, 10)
      .text("AV", 0, 0);
    const out = latin1(doc.finish());
    const a = font.advanceWidth(font.glyphForCodePoint(0x41));
    const v = font.advanceWidth(font.glyphForCodePoint(0x56));
    const kern = Number(/\[<0001>(-?[\d.]+)<0002>\] TJ/.exec(out)?.[1]);
    expect(kern).toBeGreaterThan(0);
    expect(font.widthOfText("AV", 1000)).toBe(a + v - kern);
  });

  test("glyph offsets become pen shifts and text rise", () => {
    const base = load("BarlowCondensed-Regular");
    const doc = new PdfDocument(plain);
    // A base glyph of width 500 followed by a mark placed 100 left and 250 up, with no advance.
    const fake = {
      ...metricsOf(base),
      unitsPerEm: 1000,
      advanceWidth: (glyph: number) => (glyph === 6 ? 0 : 500),
      shape: () => [
        { id: 5, cluster: 0, xAdvance: 500, xOffset: 0, yOffset: 0 },
        { id: 6, cluster: 0, xAdvance: 0, xOffset: -100, yOffset: 250 },
        { id: 5, cluster: 2, xAdvance: 480, xOffset: 0, yOffset: 0 },
      ],
    };
    doc
      .addPage({ size: [100, 100] })
      .content.font(fake, 20)
      .textRise(3)
      .text("a\u0301b", 0, 0);
    const out = latin1(doc.finish());
    expect(out).toContain(
      "3 Ts\nBT\n0 0 Td\n<0001> Tj\n8 Ts\n[100<0002>-100] TJ\n3 Ts\n[<0003>20] TJ\nET\n",
    );
    // Only the first glyph of a cluster carries its text. The same glyph standing for "b"
    // gets an ID of its own.
    expect(out).toContain("<0001> <00610301>\n");
    expect(out).not.toContain("<0002> <");
    expect(out).toContain("<0003> <0062>\n");
  });

  test("a glyph that stands for different text in different places stays searchable", async () => {
    // JetBrains Mono draws "!=" and "=>" with ligature glyphs plus a shared invisible spacer.
    const mono = load("JetBrainsMono-Variable");
    const doc = new PdfDocument(plain);
    doc
      .addPage({ size: [300, 100] })
      .content.font(mono, 12)
      .text("if (a != b) => {}", 10, 40);
    // pdf.js reports the text in several runs; whitespace-only runs are dropped by the helper.
    const runs = (await extractText(doc.finish()))[0] ?? [];
    expect(runs.join(" ").replace(/\s+/g, " ")).toBe("if (a != b) => {}");
  });

  test("maps characters outside the Basic Multilingual Plane back to text", () => {
    const doc = new PdfDocument(plain);
    const fake = {
      ...metricsOf(load("BarlowCondensed-Regular")),
      glyphForCodePoint: (codePoint: number) => (codePoint === 0x1f600 ? 7 : 0),
    };
    doc
      .addPage({ size: [100, 100] })
      .content.font(fake, 10)
      .text("😀", 10, 10);
    expect(latin1(doc.finish())).toContain("<0001> <D83DDE00>\n");
  });

  test("text the font cannot show fails with the font and character named", () => {
    const doc = new PdfDocument(plain);
    const content = doc
      .addPage({ size: [100, 100] })
      .content.font(load("BarlowCondensed-Bold"), 10);
    expect(() => content.text("日", 0, 0)).toThrow(
      /BarlowCondensed-Bold has no glyph for "日" \(U\+65E5\)/,
    );
  });

  test("refuses fonts whose licence forbids embedding", () => {
    const doc = new PdfDocument(plain);
    const restricted = { ...metricsOf(load("BarlowCondensed-Regular")), embeddable: false };
    expect(() => doc.addPage({ size: [100, 100] }).content.font(restricted, 10)).toThrow(
      /does not permit embedding/,
    );
  });

  test("the same input gives the same bytes", () => {
    const build = (): Uint8Array => {
      const doc = new PdfDocument({ deterministic: true });
      doc
        .addPage({ size: [300, 100] })
        .content.font(load("Inter-Variable"), 12)
        .text("Sama persis", 10, 40);
      return doc.finish();
    };
    expect(build()).toEqual(build());
  });
});

/** A FontProgram built from a real font, for tests that override one property. */
function metricsOf(font: TrueTypeFont) {
  return {
    postScriptName: font.postScriptName,
    unitsPerEm: font.unitsPerEm,
    ascender: font.ascender,
    descender: font.descender,
    capHeight: font.capHeight,
    bbox: font.bbox,
    italicAngle: font.italicAngle,
    isFixedPitch: font.isFixedPitch,
    isItalic: font.isItalic,
    weightClass: font.weightClass,
    embeddable: font.embeddable,
    glyphForCodePoint: (codePoint: number) => font.glyphForCodePoint(codePoint),
    advanceWidth: (glyph: number) => font.advanceWidth(glyph),
    subset: (glyphs: readonly number[]) => font.subset(glyphs),
  };
}
