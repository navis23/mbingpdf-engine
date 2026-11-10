import { describe, expect, test } from "vitest";
import { PdfDocument, StandardFonts } from "../src/core/index.ts";
import { Font } from "../src/font/index.ts";
import {
  createPatternHyphenator,
  drawParagraph,
  fitText,
  hyphenateEnglish,
  hyphenateIndonesian,
  layoutParagraph,
} from "../src/text/index.ts";
import { readFont } from "./harness/env.ts";
import { extractText } from "./harness/render.ts";

const inter = new Font(readFont("Inter-Variable"));
const barlow = new Font(readFont("BarlowCondensed-Regular"));
const { Helvetica, ZapfDingbats } = StandardFonts;

const TEXT =
  "Dengan ini menerangkan bahwa pembayaran untuk keberangkatan rombongan telah diterima " +
  "sepenuhnya, dan sertifikat penghargaan akan dikirimkan — paling lambat 14 hari.";

/** Shows where a hyphenator would split a word. */
function split(hyphenate: (word: string) => number[], word: string): string {
  let out = "";
  let last = 0;
  for (const point of hyphenate(word)) {
    out += `${word.slice(last, point)}-`;
    last = point;
  }
  return out + word.slice(last);
}

describe("hyphenation", () => {
  test("English, from the TeX patterns", () => {
    const words = [
      "hyphenation",
      "associate",
      "typography",
      "representative",
      "table",
      "project",
      "computer",
      "algorithm",
    ];
    expect(words.map((word) => split(hyphenateEnglish, word))).toEqual([
      "hy-phen-ation",
      "as-so-ciate",
      "ty-pog-ra-phy",
      "rep-re-sen-ta-tive",
      "ta-ble",
      "project",
      "com-puter",
      "al-go-rithm",
    ]);
    expect(split(hyphenateEnglish, "Hyphenation")).toBe("Hy-phen-ation");
    expect(hyphenateEnglish("a")).toEqual([]);
  });

  test("Indonesian, from the spelling guide's syllable rules", () => {
    const expected = [
      "ba-pak",
      "de-ngan",
      "man-di",
      "swas-ta",
      "bang-sa",
      "in-stru-men",
      "bang-krut",
      "ke-be-rang-ka-tan",
      "pem-ba-ya-ran",
      "mu-sya-wa-rah",
      "ser-ti-fi-kat",
      "peng-har-gaan",
      "pan-dai",
      "main",
      "In-do-ne-sia",
      "kwi-tan-si",
      "struk-tur",
      "Ap-ril",
      "ul-tra",
      "makh-luk",
      "akhir",
    ];
    expect(expected.map((word) => split(hyphenateIndonesian, word.replaceAll("-", "")))).toEqual(
      expected,
    );
    // Words with anything but plain letters are left alone.
    expect(hyphenateIndonesian("café")).toEqual([]);
  });

  test("custom patterns and exceptions", () => {
    const hyphenate = createPatternHyphenator(["a1b", "b1c", "1d", "2c1d"], {
      leftMin: 1,
      rightMin: 1,
      exceptions: ["ab-cd-ab"],
    });
    // "2c1d" forbids a break before c, overriding "b1c".
    expect(split(hyphenate, "abcd")).toBe("a-bc-d");
    expect(split(hyphenate, "abcdab")).toBe("ab-cd-ab");
    const strict = createPatternHyphenator(["a1b", "b1c", "1d"]);
    expect(split(strict, "abcdab")).toBe("ab-c-dab");
  });
});

describe("layoutParagraph", () => {
  test("wraps text so that every line fits", () => {
    const layout = layoutParagraph(TEXT, { font: inter, size: 11, width: 200 });
    expect(layout.lines.map((line) => line.text)).toEqual([
      "Dengan ini menerangkan bahwa",
      "pembayaran untuk keberangkatan",
      "rombongan telah diterima",
      "sepenuhnya, dan sertifikat",
      "penghargaan akan dikirimkan —",
      "paling lambat 14 hari.",
    ]);
    for (const line of layout.lines) {
      expect(line.width).toBeLessThanOrEqual(200);
      expect(line.width).toBeCloseTo(inter.widthOfText(line.text, 11), 6);
    }
    expect(layout.width).toBe(200);
    expect(layout.missingCharacters).toEqual([]);
  });

  test("lines stack by the font's own spacing, or by lineHeight", () => {
    const natural = layoutParagraph(TEXT, { font: inter, size: 10, width: 200 });
    const spacing = ((inter.ascender - inter.descender + inter.lineGap) * 10) / inter.unitsPerEm;
    expect(natural.lines[1]?.top).toBeCloseTo(spacing);
    expect(natural.lines[0]?.baseline).toBeCloseTo(inter.ascent(10));
    expect(natural.height).toBeCloseTo(spacing * natural.lines.length);

    const loose = layoutParagraph(TEXT, { font: inter, size: 10, width: 200, lineHeight: 2 });
    expect(loose.lines.map((line) => line.top)).toEqual(loose.lines.map((_line, i) => i * 20));
    // The extra space is split above and below the text.
    const textHeight = inter.ascent(10) + inter.descent(10);
    expect(loose.lines[0]?.baseline).toBeCloseTo((20 - textHeight) / 2 + inter.ascent(10));
  });

  test("without a width only line feeds break lines", () => {
    const layout = layoutParagraph("satu dua tiga\nempat\r\n\nenam", { font: Helvetica, size: 10 });
    expect(layout.lines.map((line) => line.text)).toEqual(["satu dua tiga", "empat", "", "enam"]);
    expect(layout.width).toBeCloseTo(Helvetica.widthOfText("satu dua tiga", 10));
    expect(layout.lines[2]?.height).toBeGreaterThan(0);
    expect(layoutParagraph("", { font: Helvetica, size: 10 }).lines).toEqual([]);
  });

  test("alignment", () => {
    const options = { font: inter, size: 11, width: 200 } as const;
    const left = layoutParagraph(TEXT, options);
    const center = layoutParagraph(TEXT, { ...options, align: "center" });
    const right = layoutParagraph(TEXT, { ...options, align: "right" });
    left.lines.forEach((line, i) => {
      expect(line.x).toBe(0);
      expect(center.lines[i]?.x).toBeCloseTo((200 - line.width) / 2);
      expect(right.lines[i]?.x).toBeCloseTo(200 - line.width);
      expect(right.lines[i]?.runs[0]?.x).toBeCloseTo(200 - line.width);
    });
  });

  test("justification stretches the word spaces of every line but the last", () => {
    const layout = layoutParagraph(TEXT, { font: inter, size: 11, width: 200, align: "justify" });
    const last = layout.lines.length - 1;
    layout.lines.forEach((line, i) => {
      if (i < last) expect(line.width).toBeCloseTo(200, 6);
      else expect(line.width).toBeLessThan(200);
    });
    // Letters keep their advances; only spaces grow.
    const run = layout.lines[0]?.runs[0];
    const plain = inter.shape(run?.text ?? "");
    run?.glyphs.forEach((glyph, i) => {
      const isSpace = run.text.charAt(glyph.cluster) === " ";
      if (isSpace) expect(glyph.xAdvance).toBeGreaterThan(plain[i]?.xAdvance ?? 0);
      else expect(glyph.xAdvance).toBe(plain[i]?.xAdvance);
    });
    // A line that ends the paragraph early is not stretched either.
    const broken = layoutParagraph("pendek\nkedua baris ini cukup panjang untuk dibungkus", {
      font: inter,
      size: 11,
      width: 200,
      align: "justify",
    });
    expect(broken.lines[0]?.width).toBeLessThan(100);
  });

  test("hyphenation fills lines better and marks the lines it split", () => {
    const layout = layoutParagraph(TEXT, {
      font: inter,
      size: 11,
      width: 200,
      hyphenate: hyphenateIndonesian,
    });
    expect(layout.lines.map((line) => line.text)).toEqual([
      "Dengan ini menerangkan bahwa pem-",
      "bayaran untuk keberangkatan rombo-",
      "ngan telah diterima sepenuhnya, dan",
      "sertifikat penghargaan akan dikirim-",
      "kan — paling lambat 14 hari.",
    ]);
    expect(layout.lines.map((line) => line.hyphenated)).toEqual([true, true, false, true, false]);
    for (const line of layout.lines) expect(line.width).toBeLessThanOrEqual(200);
  });

  test("a soft hyphen shows only where the line breaks at it", () => {
    const text = "ke­be­rang­kat­an ke­be­rang­kat­an";
    const wide = layoutParagraph(text, { font: inter, size: 12 });
    expect(wide.lines[0]?.width).toBeCloseTo(inter.widthOfText("keberangkatan keberangkatan", 12));
    const narrow = layoutParagraph(text, { font: inter, size: 12, width: 110 });
    expect(narrow.lines.map((line) => line.text.replaceAll("­", ""))).toEqual([
      "keberangkatan ke-",
      "berangkatan",
    ]);
  });

  test("a word wider than the line is split between characters", () => {
    const layout = layoutParagraph("Pneumonoultramicroscopicsilicovolcanoconiosis ya", {
      font: inter,
      size: 12,
      width: 100,
    });
    expect(layout.lines.length).toBeGreaterThan(2);
    for (const line of layout.lines) expect(line.width).toBeLessThanOrEqual(100);
    expect(layout.lines.map((line) => line.text).join("")).toBe(
      "Pneumonoultramicroscopicsilicovolcanoconiosis ya",
    );
    // Even an absurdly narrow column makes progress, one character per line.
    expect(
      layoutParagraph("abc", { font: inter, size: 12, width: 1 }).lines.map((l) => l.text),
    ).toEqual(["a", "b", "c"]);
  });

  test("letter spacing widens the text and switches ligatures off", () => {
    const plain = layoutParagraph("office", { font: barlow, size: 10 });
    const spaced = layoutParagraph("office", { font: barlow, size: 10, letterSpacing: 2 });
    expect(plain.lines[0]?.runs[0]?.glyphs.length).toBeLessThan(6);
    expect(spaced.lines[0]?.runs[0]?.glyphs.length).toBe(6);
    const unligated = barlow.widthOfText("office", 10, { features: { liga: false, clig: false } });
    // Five gaps: nothing is added after the last letter of a line.
    expect(spaced.width).toBeCloseTo(unligated + 5 * 2);
  });

  test("word spacing applies to spaces only", () => {
    const plain = layoutParagraph("a b c", { font: Helvetica, size: 10 });
    const spaced = layoutParagraph("a b c", { font: Helvetica, size: 10, wordSpacing: 4 });
    expect(spaced.width).toBeCloseTo(plain.width + 8);
  });

  test("case transforms", () => {
    const at = (transform: "uppercase" | "lowercase" | "capitalize"): string | undefined =>
      layoutParagraph("sertifikat PENGHARGAAN é", { font: inter, size: 10, transform }).lines[0]
        ?.text;
    expect(at("uppercase")).toBe("SERTIFIKAT PENGHARGAAN É");
    expect(at("lowercase")).toBe("sertifikat penghargaan é");
    expect(at("capitalize")).toBe("Sertifikat PENGHARGAAN É");
  });

  test("falls back through the font list character by character", () => {
    const layout = layoutParagraph("Lunas ✔ — ŵ 日", {
      font: [Helvetica, ZapfDingbats, inter],
      size: 12,
    });
    const runs = layout.lines[0]?.runs ?? [];
    expect(
      runs.map((run) => [
        run.font === Helvetica ? "Helvetica" : run.font === inter ? "Inter" : "Dingbats",
        run.text,
      ]),
    ).toEqual([
      ["Helvetica", "Lunas "],
      ["Dingbats", "✔ "],
      ["Helvetica", "— "],
      ["Inter", "ŵ 日"],
    ]);
    expect(layout.missingCharacters).toEqual(["日"]);
    // Runs sit side by side.
    runs.forEach((run, i) => {
      if (i > 0) expect(run.x).toBeCloseTo((runs[i - 1]?.x ?? 0) + (runs[i - 1]?.width ?? 0));
    });
  });

  test("OpenType features reach the shaper", () => {
    const proportional = layoutParagraph("1111", { font: inter, size: 10 });
    const tabular = layoutParagraph("1111", { font: inter, size: 10, features: { tnum: true } });
    expect(tabular.width).toBeGreaterThan(proportional.width);
  });

  test("rejects sizes and widths that make no sense", () => {
    expect(() => layoutParagraph("x", { font: inter, size: 0 })).toThrow(RangeError);
    expect(() => layoutParagraph("x", { font: inter, size: 10, width: 0 })).toThrow(RangeError);
    expect(() => layoutParagraph("x", { font: [], size: 10 })).toThrow(RangeError);
  });
});

describe("fitText", () => {
  test("keeps the size when the text already fits", () => {
    expect(fitText("Ani", { font: inter, width: 300, maxSize: 40 })).toEqual({
      size: 40,
      width: inter.widthOfText("Ani", 40),
      fits: true,
    });
  });

  test("shrinks long text to exactly fill the width", () => {
    const name = "Bartholomew Maximilian Wolfeschlegelstein";
    const fit = fitText(name, { font: inter, width: 300, maxSize: 40, minSize: 8 });
    expect(fit.fits).toBe(true);
    expect(fit.size).toBeLessThan(40);
    expect(fit.width).toBeCloseTo(300, 6);
    expect(inter.widthOfText(name, fit.size)).toBeCloseTo(300, 6);
  });

  test("accounts for letter spacing, which does not shrink with the size", () => {
    const fit = fitText("NOMOR PESERTA 0421", {
      font: barlow,
      width: 200,
      maxSize: 60,
      letterSpacing: 3,
    });
    expect(fit.width).toBeCloseTo(200, 6);
    expect(fit.fits).toBe(true);
  });

  test("reports when even the smallest size is too wide", () => {
    const fit = fitText("x".repeat(200), { font: inter, width: 100, maxSize: 20, minSize: 10 });
    expect(fit.size).toBe(10);
    expect(fit.fits).toBe(false);
    expect(() => fitText("x", { font: inter, width: 100, maxSize: 10, minSize: 20 })).toThrow(
      RangeError,
    );
  });
});

describe("drawParagraph", () => {
  test("draws each line at its baseline and the text can be read back", async () => {
    const doc = new PdfDocument({ xref: "table", compress: false, deterministic: true });
    const layout = layoutParagraph(TEXT, { font: inter, size: 11, width: 200, align: "justify" });
    drawParagraph(doc.addPage({ size: [300, 200] }).content, layout, 50, 180);
    const pdf = doc.finish();
    const out = new TextDecoder("latin1").decode(pdf);
    const first = layout.lines[0];
    const second = layout.lines[1];
    expect(out).toContain(
      `BT\n50 ${(180 - (first?.baseline ?? 0)).toFixed(3).replace(/\.?0+$/, "")} Td\n`,
    );
    expect(out).toContain(
      `BT\n50 ${(180 - (second?.baseline ?? 0)).toFixed(3).replace(/\.?0+$/, "")} Td\n`,
    );
    const words = (await extractText(pdf))[0]?.join(" ").replace(/\s+/g, " ");
    expect(words).toBe(TEXT);
  });

  test("standard fonts are justified too", async () => {
    const doc = new PdfDocument({ xref: "table", compress: false, deterministic: true });
    const layout = layoutParagraph("satu dua tiga empat lima enam tujuh delapan", {
      font: Helvetica,
      size: 10,
      width: 120,
      align: "justify",
    });
    drawParagraph(doc.addPage({ size: [200, 100] }).content, layout, 10, 90);
    const pdf = doc.finish();
    const out = new TextDecoder("latin1").decode(pdf);
    // The stretched spaces appear as adjustments that move the pen right after each space.
    expect(out).toMatch(
      /\[\(satu \)-[\d.]+\(dua \)-[\d.]+\(tiga \)-[\d.]+\(empat \)-[\d.]+\(lima\)\] TJ/,
    );
    // The last line keeps its natural spacing.
    expect(out).toContain("(enam tujuh delapan) Tj");
    expect((await extractText(pdf))[0]?.join(" ")).toBe(
      "satu dua tiga empat lima enam tujuh delapan",
    );
  });

  test("a character no font has is skipped by a standard font and boxed by an embedded one", async () => {
    const doc = new PdfDocument({ xref: "table", compress: false, deterministic: true });
    const content = doc.addPage({ size: [200, 100] }).content;
    const standard = layoutParagraph("a日b", { font: Helvetica, size: 10 });
    const embedded = layoutParagraph("a日b", { font: barlow, size: 10 });
    expect(standard.missingCharacters).toEqual(["日"]);
    expect(embedded.missingCharacters).toEqual(["日"]);
    drawParagraph(content, standard, 10, 90);
    drawParagraph(content, embedded, 10, 50);
    const pdf = doc.finish();
    const out = new TextDecoder("latin1").decode(pdf);
    expect(out).toContain("(ab) Tj");
    // The embedded font draws its "missing" box, which still copies out as the character.
    expect(out).toContain("<000100020003> Tj");
    expect(out).toContain("<0002> <65E5>\n");
    expect((await extractText(pdf))[0]).toEqual(["ab", "a日b"]);
  });
});
