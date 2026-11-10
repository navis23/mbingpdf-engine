import * as hb from "harfbuzzjs";
import { describe, expect, test } from "vitest";
import { Font, type ShapeOptions } from "../src/font/index.ts";
import { readFont } from "./harness/env.ts";
import { FONT_FILES, type FontFile } from "./harness/samples.ts";

const TEXTS = [
  "AVATAR Tokyo, WAVE. Yes! To: “Type”",
  "office fjord affluent ffi fl fi",
  "1/2 3->4 => != <= --- :: 12:30 (a) [b] {c}",
  "Rp 1.250.000 — “lunas” é ü ŵ ß",
  "é ǟ ố q̃ Å ñ",
  "Đặng Thị Ánh, Việt Nam",
  "H-E T.V. P, F. r, y. L’A",
  "x->y <-> 0x1F a:b 3×4 9:41",
  "ĲSSELMEER İstanbul ǆ",
  "naïve café – piñata… ¿Qué?",
  "Sertifikat Penghargaan Nomor 0123/VI/2026",
  "Αθήνα και Ελλάδα — Привет, мир! Съешь ещё",
  "",
  " ",
  "日本語 mixed with Latin",
];

/** Every pair of printable ASCII characters, to exercise the kerning tables broadly. */
function asciiPairs(): string[] {
  const lines: string[] = [];
  for (let a = 0x21; a < 0x7f; a++) {
    let line = "";
    for (let b = 0x21; b < 0x7f; b++) line += String.fromCharCode(a, b, 0x20);
    lines.push(line);
  }
  return lines;
}

const describeGlyphs = (
  glyphs: readonly {
    id: number;
    cluster: number;
    xAdvance: number;
    xOffset: number;
    yOffset: number;
  }[],
): string =>
  glyphs.map((g) => `${g.id}@${g.cluster}+${g.xAdvance}/${g.xOffset},${g.yOffset}`).join(" ");

function withHarfbuzz(reference: hb.Font, text: string, features: hb.Feature[] = []): string {
  const buffer = new hb.Buffer();
  buffer.addText(text);
  buffer.guessSegmentProperties();
  hb.shape(reference, buffer, features);
  const positions = buffer.getGlyphPositions();
  return describeGlyphs(
    buffer.getGlyphInfos().map((info, i) => ({
      id: info.codepoint,
      cluster: info.cluster,
      xAdvance: positions[i]?.xAdvance ?? 0,
      xOffset: positions[i]?.xOffset ?? 0,
      yOffset: positions[i]?.yOffset ?? 0,
    })),
  );
}

const fonts = new Map<FontFile, { font: Font; reference: hb.Font }>();
function load(file: FontFile): { font: Font; reference: hb.Font } {
  let entry = fonts.get(file);
  if (!entry) {
    const bytes = readFont(file);
    entry = {
      font: new Font(bytes),
      reference: new hb.Font(new hb.Face(new hb.Blob(bytes.slice().buffer))),
    };
    fonts.set(file, entry);
  }
  return entry;
}

describe("shaping agrees with HarfBuzz", () => {
  test.each(FONT_FILES)("a corpus of real text: %s", (file) => {
    const { font, reference } = load(file);
    for (const text of TEXTS) {
      expect(describeGlyphs(font.shape(text)), JSON.stringify(text)).toBe(
        withHarfbuzz(reference, text),
      );
    }
  });

  test.each(FONT_FILES)("every pair of ASCII characters: %s", (file) => {
    const { font, reference } = load(file);
    for (const line of asciiPairs()) {
      expect(describeGlyphs(font.shape(line)), JSON.stringify(line)).toBe(
        withHarfbuzz(reference, line),
      );
    }
  });

  const toggles: [string, NonNullable<ShapeOptions["features"]>, [string, number][]][] = [
    ["kerning off", { kern: false }, [["kern", 0]]],
    [
      "ligatures off",
      { liga: false, clig: false },
      [
        ["liga", 0],
        ["clig", 0],
      ],
    ],
    ["contextual alternates off", { calt: false }, [["calt", 0]]],
    ["tabular figures", { tnum: true }, [["tnum", 1]]],
    ["small capitals", { smcp: true }, [["smcp", 1]]],
    [
      "slashed zero and case forms",
      { zero: true, case: true },
      [
        ["zero", 1],
        ["case", 1],
      ],
    ],
    ["stylistic set 1", { ss01: true }, [["ss01", 1]]],
    ["fractions", { frac: true }, [["frac", 1]]],
    ["character variant, second alternate", { cv05: 2 }, [["cv05", 2]]],
    ["superscript", { sups: true }, [["sups", 1]]],
  ];
  test.each(toggles)("feature toggles: %s", (_label, features, reference) => {
    for (const file of FONT_FILES) {
      const loaded = load(file);
      for (const text of [
        "AVATAR office 0123456789",
        "(H-O) 1/2 [x] ¿a? 10:30",
        "Total: Rp 1.250.000",
      ]) {
        expect(describeGlyphs(loaded.font.shape(text, { features })), `${file} ${text}`).toBe(
          withHarfbuzz(
            loaded.reference,
            text,
            reference.map(([tag, value]) => new hb.Feature(tag, value)),
          ),
        );
      }
    }
  });
});

describe("shaping", () => {
  test("kerning and ligatures change the result", () => {
    const { font } = load("Inter-Variable");
    const kerned = font.widthOfText("AVATAR", 100);
    const unkerned = font.widthOfText("AVATAR", 100, { features: { kern: false } });
    expect(kerned).toBeLessThan(unkerned);

    const barlow = load("BarlowCondensed-Regular").font;
    expect(barlow.shape("fi").length).toBe(1);
    expect(barlow.shape("fi", { features: { liga: false } }).length).toBe(2);
    expect(barlow.shape("fi")[0]?.cluster).toBe(0);
  });

  test("characters the font lacks come back as glyph 0", () => {
    const { font } = load("BarlowCondensed-Regular");
    const glyphs = font.shape("a日b");
    expect(glyphs.map((glyph) => glyph.id === 0)).toEqual([false, true, false]);
    expect(glyphs.map((glyph) => glyph.cluster)).toEqual([0, 1, 2]);
  });

  test("joiners and soft hyphens produce no glyph", () => {
    const { font } = load("Inter-Variable");
    expect(font.shape("a­b‍c️").map((glyph) => glyph.cluster)).toEqual([0, 2, 4]);
  });

  test("a no-break space falls back to the space glyph", () => {
    const { font } = load("BarlowCondensed-Regular");
    const fake = {
      table: (tag: string) => font.table(tag),
      advanceWidth: (glyph: number) => font.advanceWidth(glyph),
      glyphForCodePoint: (codePoint: number) =>
        codePoint === 0xa0 ? 0 : font.glyphForCodePoint(codePoint),
    };
    expect(font.shaper.shape(fake, " ")[0]?.id).toBe(font.glyphForCodePoint(0x20));
  });

  test("a custom shaper can be plugged in", () => {
    const font = new Font(readFont("BarlowCondensed-Regular"));
    font.shaper = {
      shape: (_font, text) =>
        [...text].map((_char, i) => ({
          id: 5,
          cluster: i,
          xAdvance: 500,
          yAdvance: 0,
          xOffset: 0,
          yOffset: 0,
        })),
    };
    expect(font.widthOfText("abc", 10)).toBe(15);
  });
});
