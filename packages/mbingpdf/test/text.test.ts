import { describe, expect, test } from "vitest";
import { ContentStream, PageSizes, PdfDocument, StandardFonts } from "../src/core/index.ts";

const latin1 = (bytes: Uint8Array): string => new TextDecoder("latin1").decode(bytes);
const plain = { xref: "table", compress: false, deterministic: true } as const;

describe("StandardFont", () => {
  test("there are fourteen, with their PostScript names", () => {
    const names = Object.values(StandardFonts).map((font) => font.name);
    expect(names.sort()).toEqual(
      [
        "Helvetica",
        "Helvetica-Bold",
        "Helvetica-Oblique",
        "Helvetica-BoldOblique",
        "Times-Roman",
        "Times-Bold",
        "Times-Italic",
        "Times-BoldItalic",
        "Courier",
        "Courier-Bold",
        "Courier-Oblique",
        "Courier-BoldOblique",
        "Symbol",
        "ZapfDingbats",
      ].sort(),
    );
  });

  test("header metrics", () => {
    const { Helvetica, TimesItalic, Courier } = StandardFonts;
    expect(Helvetica.ascender).toBe(718);
    expect(Helvetica.descender).toBe(-207);
    expect(Helvetica.capHeight).toBe(718);
    expect(Helvetica.xHeight).toBe(523);
    expect(Helvetica.ascent(10)).toBeCloseTo(7.18);
    expect(Helvetica.descent(10)).toBeCloseTo(2.07);
    expect(TimesItalic.italicAngle).toBe(-15.5);
    expect(Courier.bbox).toEqual([-23, -250, 715, 805]);
  });

  test("measures text from the bundled widths", () => {
    const { Helvetica, HelveticaBold, TimesRoman, Courier, CourierBold } = StandardFonts;
    // Known AFM widths: H 722, e 556, l 222, o 556 in Helvetica.
    expect(Helvetica.widthOfText("Hello", 1000)).toBe(722 + 556 + 222 + 222 + 556);
    expect(Helvetica.widthOfText("Hello", 12)).toBeCloseTo(27.336);
    expect(HelveticaBold.widthOfText("A", 1000)).toBe(722);
    expect(TimesRoman.widthOfText("The quick brown fox", 1000)).toBe(8415);
    expect(Courier.widthOfText("any text at all", 10)).toBe(90);
    expect(CourierBold.widthOfText("Wi", 1000)).toBe(1200);
    expect(Helvetica.widthOfText("", 12)).toBe(0);
  });

  test("encodes Windows-1252, including characters outside Latin-1", () => {
    const { Helvetica } = StandardFonts;
    expect(Array.from(Helvetica.encode("Aé"))).toEqual([0x41, 0xe9]);
    expect(Array.from(Helvetica.encode("€–—“”‘’…•™"))).toEqual([
      0x80, 0x96, 0x97, 0x93, 0x94, 0x91, 0x92, 0x85, 0x95, 0x99,
    ]);
    expect(Helvetica.widthOfText("€", 1000)).toBe(556);
    expect(Helvetica.widthOfText(" ", 1000)).toBe(278);
  });

  test("reports characters it cannot encode", () => {
    const { Helvetica } = StandardFonts;
    expect(Helvetica.canEncode("Rp 1.250.000 — lunas")).toBe(true);
    expect(Helvetica.canEncode("→")).toBe(false);
    expect(Helvetica.canEncode("😀")).toBe(false);
    expect(() => Helvetica.encode("a→b")).toThrow('Helvetica has no glyph for "→" (U+2192)');
    expect(() => Helvetica.widthOfText("日本", 12)).toThrow(RangeError);
    expect(() => Helvetica.encode("tab\there")).toThrow(/U\+0009/);
  });

  test("Symbol and ZapfDingbats use their own encodings", () => {
    const { Symbol: SymbolFont, ZapfDingbats } = StandardFonts;
    expect(SymbolFont.symbolic).toBe(true);
    expect(Array.from(SymbolFont.encode("αβ∑"))).toEqual([0x61, 0x62, 0xe5]);
    expect(SymbolFont.widthOfText("α", 1000)).toBe(631);
    expect(SymbolFont.canEncode("A")).toBe(false);
    expect(Array.from(ZapfDingbats.encode("✔✈"))).toEqual([0x34, 0x28]);
    expect(ZapfDingbats.widthOfText("✔", 1000)).toBe(846);
  });
});

describe("text in content streams", () => {
  test("shows text with the selected font", () => {
    const doc = new PdfDocument(plain);
    const page = doc.addPage({ size: PageSizes.A4 });
    page.content
      .font(StandardFonts.Helvetica, 12)
      .text("Hello (world) \\ é", 72, 700)
      .font(StandardFonts.TimesBold, 9.5)
      .beginText()
      .textMatrix(1, 0, 0, 1, 72, 680)
      .showText("One")
      .moveText(0, -12)
      .showText("Two")
      .endText();
    doc.addPage({ size: PageSizes.A4 }).content.font(StandardFonts.Helvetica, 8).text("x", 0, 0);
    const out = latin1(doc.finish());
    expect(out).toContain("/F1 12 Tf\nBT\n72 700 Td\n(Hello \\(world\\) \\\\ \xe9) Tj\nET\n");
    expect(out).toContain("/F2 9.5 Tf\nBT\n1 0 0 1 72 680 Tm\n(One) Tj\n0 -12 Td\n(Two) Tj\nET\n");
    expect(out.match(/\/BaseFont\/Helvetica\//g)?.length).toBe(1);
    expect(out).toContain(
      "<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>",
    );
    expect(out).toContain(
      "<</Type/Font/Subtype/Type1/BaseFont/Times-Bold/Encoding/WinAnsiEncoding>>",
    );
    expect(out).toMatch(/\/Resources<<\/Font<<\/F1 \d+ 0 R\/F2 \d+ 0 R>>>>/);
    expect(out).toMatch(/\/Resources<<\/Font<<\/F1 \d+ 0 R>>>>/);
  });

  test("symbolic fonts are written without an encoding", () => {
    const doc = new PdfDocument(plain);
    doc
      .addPage({ size: [100, 100] })
      .content.font(StandardFonts.ZapfDingbats, 10)
      .text("✔", 5, 5);
    const out = latin1(doc.finish());
    expect(out).toContain("<</Type/Font/Subtype/Type1/BaseFont/ZapfDingbats>>");
    expect(out).toContain("(4) Tj");
  });

  test("text state operators", () => {
    const c = new ContentStream()
      .characterSpacing(0.5)
      .wordSpacing(2)
      .textRise(-3)
      .textRenderingMode("stroke")
      .textRenderingMode("invisible");
    expect(new TextDecoder().decode(c.toBytes())).toBe("0.5 Tc\n2 Tw\n-3 Ts\n1 Tr\n3 Tr\n");
  });

  test("the font follows save and restore", () => {
    const doc = new PdfDocument(plain);
    const content = doc.addPage({ size: [100, 100] }).content;
    content.save().font(StandardFonts.Courier, 10).restore();
    expect(() => content.text("lost", 0, 0)).toThrow(/Select a font/);
  });

  test("text objects are checked", () => {
    const doc = new PdfDocument(plain);
    const content = doc.addPage({ size: [100, 100] }).content.font(StandardFonts.Courier, 10);
    expect(() => content.showText("x")).toThrow(/between beginText\(\) and endText\(\)/);
    expect(() => content.endText()).toThrow(/between beginText/);
    content.beginText();
    expect(() => content.beginText()).toThrow(/not allowed inside a text object/);
    expect(() => content.save()).toThrow(/not allowed inside a text object/);
    expect(() => content.toBytes()).toThrow(/without a matching endText/);
    content.endText();
    expect(() => new ContentStream().font(StandardFonts.Courier, 10)).toThrow(/belongs to a page/);
    expect(() => content.font(StandardFonts.Courier, 0)).toThrow(RangeError);
  });

  test("unencodable text fails with the font and character named", () => {
    const doc = new PdfDocument(plain);
    const content = doc.addPage({ size: [100, 100] }).content.font(StandardFonts.Helvetica, 10);
    expect(() => content.text("日", 0, 0)).toThrow(/Helvetica has no glyph for "日" \(U\+65E5\)/);
  });
});
