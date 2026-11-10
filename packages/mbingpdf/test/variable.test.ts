import * as hb from "harfbuzzjs";
import { describe, expect, test } from "vitest";
import { PdfDocument } from "../src/core/index.ts";
import { TrueTypeFont } from "../src/font/index.ts";
import { readFont } from "./harness/env.ts";
import { extractText } from "./harness/render.ts";
import type { FontFile } from "./harness/samples.ts";

const INSTANCES: [FontFile, Record<string, number>][] = [
  ["Inter-Variable", { wght: 700 }],
  ["Inter-Variable", { wght: 100, opsz: 32 }],
  ["Inter-Variable", { wght: 555, opsz: 20 }],
  ["Inter-Variable", { wght: 900, opsz: 14 }],
  ["JetBrainsMono-Variable", { wght: 800 }],
  ["JetBrainsMono-Variable", { wght: 250 }],
  ["PlusJakartaSans-Variable", { wght: 800 }],
  ["PlusJakartaSans-Variable", { wght: 200 }],
  ["PlusJakartaSans-Variable", { wght: 637 }],
];

function reference(file: FontFile, settings: Record<string, number>): hb.Font {
  const font = new hb.Font(new hb.Face(new hb.Blob(readFont(file).slice().buffer)));
  font.setVariations(Object.entries(settings).map(([tag, value]) => new hb.Variation(tag, value)));
  return font;
}

const numbers = (path: string): number[] => (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
const commands = (path: string): string => path.replace(/[-\d.]+/g, "");

describe("variable fonts", () => {
  test("lists axes and named styles", () => {
    const inter = new TrueTypeFont(readFont("Inter-Variable"));
    expect(inter.axes).toEqual([
      { tag: "opsz", name: "Optical size", min: 14, default: 14, max: 32 },
      { tag: "wght", name: "Weight", min: 100, default: 400, max: 900 },
    ]);
    expect(inter.namedInstances.map((instance) => instance.name)).toContain("Bold");
    expect(inter.variationCoords).toBeUndefined();
    expect(new TrueTypeFont(readFont("BarlowCondensed-Regular")).axes).toEqual([]);
  });

  test("an instance is named after the matching style", () => {
    const inter = new TrueTypeFont(readFont("Inter-Variable"));
    const bold = inter.instance({ wght: 700 });
    expect(bold.postScriptName).toBe("Inter-Bold");
    expect(bold.subfamilyName).toBe("Bold");
    expect(bold.weightClass).toBe(700);
    expect(inter.instance("bold").postScriptName).toBe("Inter-Bold");
    expect(inter.instance({ wght: 555, opsz: 20 }).postScriptName).toBe("Inter-opsz20wght555");
    // The default position is the font itself.
    expect(inter.instance({ wght: 400 }).variationCoords).toBeUndefined();
    expect(inter.instance({ wght: 400 }).postScriptName).toBe("Inter-Regular");
  });

  test("values outside an axis are clamped", () => {
    const jakarta = new TrueTypeFont(readFont("PlusJakartaSans-Variable"));
    const glyph = jakarta.glyphForCodePoint(0x6d);
    expect(jakarta.instance({ wght: 5000 }).advanceWidth(glyph)).toBe(
      jakarta.instance({ wght: 800 }).advanceWidth(glyph),
    );
  });

  test("rejects unknown axes, unknown styles and static fonts", () => {
    const inter = new TrueTypeFont(readFont("Inter-Variable"));
    expect(() => inter.instance({ wdth: 80 })).toThrow(
      'Font has no "wdth" axis; it has opsz, wght',
    );
    expect(() => inter.instance("Chunky")).toThrow(/no style named "Chunky"; it has .*Bold/);
    const barlow = new TrueTypeFont(readFont("BarlowCondensed-Regular"));
    expect(() => barlow.instance({ wght: 700 })).toThrow(/not a variable font/);
  });

  test.each(INSTANCES)("advances and outlines agree with HarfBuzz: %s %j", (file, settings) => {
    const base = new TrueTypeFont(readFont(file));
    const font = base.instance(settings);
    const expected = reference(file, settings);
    const all = Array.from({ length: base.numGlyphs }, (_, i) => i);
    const subset = font.subset(all);
    const rebuilt = new hb.Font(new hb.Face(new hb.Blob(subset.data.slice().buffer)));

    let inexactAdvances = 0;
    let largestOutlineDifference = 0;
    for (const glyph of all) {
      const advance = expected.glyphHAdvance(glyph);
      // A delta that lands exactly on a half can round either way in 32-bit floats.
      expect(
        Math.abs(font.advanceWidth(glyph) - advance),
        `advance of glyph ${glyph}`,
      ).toBeLessThanOrEqual(1);
      if (font.advanceWidth(glyph) !== advance) inexactAdvances++;
      expect(rebuilt.glyphHAdvance(glyph)).toBe(font.advanceWidth(glyph));

      const want = expected.glyphToPath(glyph);
      const got = rebuilt.glyphToPath(glyph);
      expect(commands(got), `outline structure of glyph ${glyph}`).toBe(commands(want));
      const a = numbers(want);
      const b = numbers(got);
      for (let i = 0; i < a.length; i++) {
        largestOutlineDifference = Math.max(
          largestOutlineDifference,
          Math.abs((a[i] as number) - (b[i] as number)),
        );
      }
    }
    expect(inexactAdvances).toBeLessThanOrEqual(base.numGlyphs * 0.005);
    // The subset stores integer coordinates; HarfBuzz reports fractional ones.
    expect(largestOutlineDifference).toBeLessThanOrEqual(1.01);
  });

  test.each(INSTANCES)("shaping agrees with HarfBuzz: %s %j", (file, settings) => {
    const font = new TrueTypeFont(readFont(file)).instance(settings);
    const expected = reference(file, settings);
    const texts = [
      "AVATAR Tokyo, WAVE. Yes! To: “Type”",
      "office fjord ffi 1/2 3->4 => != 12:30 (a) [b]",
      "é ǟ Đặng Thị Ánh q̃ $100 ¢ ß",
      "H-E T.V. P, F. r, y. L’A x->y 0x1F 9:41",
    ];
    for (let a = 0x21; a < 0x7f; a += 3) {
      let line = "";
      for (let b = 0x21; b < 0x7f; b++) line += String.fromCharCode(a, b, 0x20);
      texts.push(line);
    }
    for (const text of texts) {
      const buffer = new hb.Buffer();
      buffer.addText(text);
      buffer.guessSegmentProperties();
      hb.shape(expected, buffer);
      const positions = buffer.getGlyphPositions();
      const want = buffer.getGlyphInfos().map((info, i) => ({
        id: info.codepoint,
        cluster: info.cluster,
        xAdvance: positions[i]?.xAdvance,
        xOffset: positions[i]?.xOffset,
        yOffset: positions[i]?.yOffset,
      }));
      const got = font.shape(text).map(({ id, cluster, xAdvance, xOffset, yOffset }) => ({
        id,
        cluster,
        xAdvance,
        xOffset,
        yOffset,
      }));
      expect(
        got.map((glyph) => glyph.id),
        text,
      ).toEqual(want.map((glyph) => glyph.id));
      got.forEach((glyph, i) => {
        const other = want[i] as (typeof want)[number];
        expect(glyph.cluster).toBe(other.cluster);
        expect(Math.abs(glyph.xAdvance - (other.xAdvance ?? 0))).toBeLessThanOrEqual(1);
        expect(Math.abs(glyph.xOffset - (other.xOffset ?? 0))).toBeLessThanOrEqual(1);
        expect(Math.abs(glyph.yOffset - (other.yOffset ?? 0))).toBeLessThanOrEqual(1);
      });
    }
  });

  test("heavier weights are wider and embed under their own name", async () => {
    const jakarta = new TrueTypeFont(readFont("PlusJakartaSans-Variable"));
    const light = jakarta.instance("ExtraLight");
    const heavy = jakarta.instance("ExtraBold");
    expect(heavy.widthOfText("Sertifikat", 100)).toBeGreaterThan(
      light.widthOfText("Sertifikat", 100),
    );

    const doc = new PdfDocument({ xref: "table", compress: false, deterministic: true });
    const content = doc.addPage({ size: [300, 100] }).content;
    content.font(light, 14).text("ringan", 10, 60);
    content.font(heavy, 14).text("tebal", 10, 30);
    const pdf = doc.finish();
    const out = new TextDecoder("latin1").decode(pdf);
    expect(out).toMatch(/\/BaseFont\/[A-Z]{6}\+PlusJakartaSans-ExtraLight\b/);
    expect(out).toMatch(/\/BaseFont\/[A-Z]{6}\+PlusJakartaSans-ExtraBold\b/);
    expect(out.match(/\/Subtype\/Type0/g)?.length).toBe(2);
    expect(await extractText(pdf)).toEqual([["ringan", "tebal"]]);
  });

  test("an instance is written without hinting programs", () => {
    const mono = new TrueTypeFont(readFont("JetBrainsMono-Variable"));
    const tables = (data: Uint8Array): string => {
      const count = new DataView(data.buffer, data.byteOffset).getUint16(4);
      let tags = "";
      for (let i = 0; i < count; i++)
        tags += `${String.fromCharCode(...data.subarray(12 + i * 16, 16 + i * 16))} `;
      return tags.trim();
    };
    expect(tables(mono.instance({ wght: 700 }).subset([0, 5]).data)).toBe(
      "glyf head hhea hmtx loca maxp",
    );
  });
});
