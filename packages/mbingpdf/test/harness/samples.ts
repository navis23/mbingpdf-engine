/**
 * Sample documents used by the structural, visual and cross-runtime checks.
 *
 * Each builder receives the library modules and the test fonts instead of importing them, so
 * the same file can be run against the source (in Vitest) and against the built package (on
 * Bun, Deno and in a browser). Only type-only imports are allowed here, and every sample must
 * be deterministic.
 */
import type * as Core from "../../src/core/index.ts";
import type * as Font from "../../src/font/index.ts";

export type CoreModule = typeof Core;

/** Font files in `test/fonts/`, without the `.ttf` extension. */
export const FONT_FILES = [
  "Inter-Variable",
  "JetBrainsMono-Variable",
  "PlusJakartaSans-Variable",
  "BarlowCondensed-Regular",
  "BarlowCondensed-Bold",
] as const;

export type FontFile = (typeof FONT_FILES)[number];

/** Everything a sample may use. */
export interface SampleEnv {
  readonly core: CoreModule;
  readonly font: typeof Font;
  /** The bytes of each test font. */
  readonly fonts: Readonly<Record<FontFile, Uint8Array>>;
}

export interface Sample {
  /** The text each page is expected to yield when extracted, in reading order. */
  readonly text: readonly (readonly string[])[];
  build(env: SampleEnv): Uint8Array;
}

const shapes: Sample = {
  text: [[], []],
  build({ core }) {
    const { PdfDocument, PageSizes, printBoxes, mm, rgb, cmyk, gray, hex } = core;
    const doc = new PdfDocument({ deterministic: true, info: { title: "Shapes" } });

    const boxes = printBoxes([mm(100), mm(140)], mm(3), mm(5));
    const [bx1, by1, bx2, by2] = boxes.bleedBox;
    const [tx1, ty1, tx2, ty2] = boxes.trimBox;
    const c = doc.addPage(boxes).content;
    c.fillColor(cmyk(0.1, 0, 0.3, 0))
      .rect(bx1, by1, bx2 - bx1, by2 - by1)
      .fill();
    c.strokeColor(gray(0.3))
      .lineWidth(0.5)
      .dash([3, 2])
      .rect(tx1, ty1, tx2 - tx1, ty2 - ty1)
      .stroke()
      .dash([]);
    c.group((g) =>
      g
        .opacity(0.6)
        .fillColor(rgb(1, 0, 0))
        .circle(120, 330, 45)
        .fill()
        .fillColor(rgb(0, 0.6, 0))
        .circle(170, 330, 45)
        .fill()
        .fillColor(hex("#0044ff"))
        .circle(145, 290, 45)
        .fill(),
    );
    c.group((g) =>
      g
        .opacity({ stroke: 0.5 })
        .fillColor(cmyk(0, 0.2, 0.9, 0))
        .strokeColor(cmyk(0.9, 0.6, 0, 0.2))
        .lineWidth(8)
        .lineJoin("round")
        .roundedRect(70, 150, 180, 70, 18)
        .fillAndStroke(),
    );
    c.group((g) => {
      g.rotate(20, 160, 90).ellipse(160, 90, 80, 30).clip();
      g.fillColor(gray(0.15));
      for (let x = 60; x < 260; x += 14) g.rect(x, 50, 7, 80);
      g.fill();
    });
    c.group((g) => {
      g.translate(250, 400)
        .scale(0.5)
        .fillColor(rgb(0.5, 0, 0.5));
      for (let i = 0; i < 5; i++) {
        const angle = Math.PI / 2 + (i * 4 * Math.PI) / 5;
        const x = 60 * Math.cos(angle);
        const y = 60 * Math.sin(angle);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath().fill("evenodd");
    });

    const second = doc.addPage({ size: PageSizes.A6 }).content;
    second
      .strokeColor(rgb(0.8, 0.1, 0.1))
      .lineWidth(3)
      .lineCap("round")
      .moveTo(30, 30)
      .quadraticCurveTo(30, 30, 150, 380, 270, 30)
      .stroke();
    second.lineWidth(6).strokeColor(gray(0.2));
    (["butt", "round", "square"] as const).forEach((cap, i) => {
      second
        .lineCap(cap)
        .moveTo(40, 300 + i * 20)
        .lineTo(120, 300 + i * 20)
        .stroke();
    });
    (["miter", "round", "bevel"] as const).forEach((join, i) => {
      second
        .lineJoin(join)
        .moveTo(160 + i * 40, 300)
        .lineTo(175 + i * 40, 340)
        .lineTo(190 + i * 40, 300)
        .stroke();
    });
    return doc.finish();
  },
};

const FONT_LINE = "Rp 1.250.000 — “lunas” é ü €";

const text: Sample = {
  text: [
    [
      `Courier: ${FONT_LINE}`,
      `Courier-Bold: ${FONT_LINE}`,
      `Courier-BoldOblique: ${FONT_LINE}`,
      `Courier-Oblique: ${FONT_LINE}`,
      `Helvetica: ${FONT_LINE}`,
      `Helvetica-Bold: ${FONT_LINE}`,
      `Helvetica-BoldOblique: ${FONT_LINE}`,
      `Helvetica-Oblique: ${FONT_LINE}`,
      `Times-Bold: ${FONT_LINE}`,
      `Times-BoldItalic: ${FONT_LINE}`,
      `Times-Italic: ${FONT_LINE}`,
      `Times-Roman: ${FONT_LINE}`,
      "Subtotal 1.000.000",
      "PPN 11% 110.000",
      "Total 1.110.000",
      "Rotated text",
    ],
  ],
  build({ core }) {
    const { PdfDocument, PageSizes, StandardFonts, rgb, gray } = core;
    const doc = new PdfDocument({ deterministic: true, info: { title: "Text" } });
    const page = doc.addPage({ size: PageSizes.A5 });
    const c = page.content;
    const fonts = Object.values(StandardFonts)
      .filter((font) => !font.symbolic)
      .sort((a, b) => (a.name < b.name ? -1 : 1));
    let y = page.height - 40;
    for (const font of fonts) {
      const line = `${font.name}: ${FONT_LINE}`;
      c.font(font, 13).fillColor(gray(0)).text(line, 30, y);
      // Drawn from the measured width, so the box must hug the text.
      c.strokeColor(rgb(1, 0, 0))
        .lineWidth(0.3)
        .rect(
          30,
          y - font.descent(13),
          font.widthOfText(line, 13),
          font.ascent(13) + font.descent(13),
        )
        .stroke();
      y -= 26;
    }
    c.font(StandardFonts.Symbol, 13).text("αβγδ ∑∏∫ ≤≥≠", 30, y);
    c.font(StandardFonts.ZapfDingbats, 13).text("✔✈✂★❤➔", 200, y);
    y -= 30;

    const right = page.width - 30;
    c.strokeColor(rgb(0, 0, 1))
      .moveTo(right, y + 12)
      .lineTo(right, y - 44)
      .stroke();
    const bold = StandardFonts.HelveticaBold;
    for (const line of ["Subtotal 1.000.000", "PPN 11% 110.000", "Total 1.110.000"]) {
      c.font(bold, 12).text(line, right - bold.widthOfText(line, 12), y);
      y -= 18;
    }
    c.group((g) =>
      g
        .font(StandardFonts.TimesBoldItalic, 30)
        .fillColor(rgb(0.1, 0.5, 0.2))
        .opacity(0.5)
        .beginText()
        .textMatrix(0.94, 0.34, -0.34, 0.94, 60, y - 60)
        .showText("Rotated text")
        .endText(),
    );
    return doc.finish();
  },
};

/** The M0 exit document: shapes and standard-font text on several pages. */
const report: Sample = {
  text: [1, 2, 3].map((n) => [
    "Laporan Bulanan",
    `Halaman ${n} dari 3`,
    ...[1, 2, 3, 4, 5, 6].map((row) => `Baris ${row} — nilai ${n * row * 125}`),
  ]),
  build({ core }) {
    const { PdfDocument, PageSizes, StandardFonts, rgb, gray, hex } = core;
    const doc = new PdfDocument({
      deterministic: true,
      info: { title: "Laporan Bulanan", author: "mbingpdf", subject: "M0 exit sample" },
    });
    const [width, height] = PageSizes.A5;
    for (let n = 1; n <= 3; n++) {
      const c = doc.addPage({ size: PageSizes.A5 }).content;
      c.fillColor(hex("#1d4ed8"))
        .rect(0, height - 70, width, 70)
        .fill();
      c.fillColor(gray(1))
        .font(StandardFonts.HelveticaBold, 22)
        .text("Laporan Bulanan", 30, height - 45);
      const label = `Halaman ${n} dari 3`;
      const small = StandardFonts.Helvetica;
      c.font(small, 10).text(label, width - 30 - small.widthOfText(label, 10), height - 42);

      let y = height - 110;
      for (let row = 1; row <= 6; row++) {
        if (row % 2 === 1)
          c.fillColor(gray(0.94))
            .rect(30, y - 8, width - 60, 24)
            .fill();
        c.fillColor(gray(0.1)).font(StandardFonts.TimesRoman, 12);
        c.text(`Baris ${row} — nilai ${n * row * 125}`, 40, y);
        y -= 24;
      }
      // A bar chart whose heights depend on the page.
      c.group((g) => {
        g.translate(40, 60);
        g.strokeColor(gray(0.5)).lineWidth(0.75).moveTo(0, 0).lineTo(300, 0).stroke();
        for (let bar = 0; bar < 8; bar++) {
          const value = 20 + ((bar * 37 + n * 53) % 120);
          g.fillColor(rgb(0.15 + bar * 0.1, 0.45, 0.85 - bar * 0.08))
            .roundedRect(10 + bar * 36, 0, 24, value, 4)
            .fill();
        }
      });
    }
    return doc.finish();
  },
};

const EMBEDDED_LINE = "Rp 1.250.000 — “lunas” é ü ŵ ß fi";

/** Embedded TrueType fonts: subsetting, composite glyphs, text extraction. */
const fonts: Sample = {
  text: [
    [
      `Inter: ${EMBEDDED_LINE}`,
      `JetBrains Mono: ${EMBEDDED_LINE}`,
      `Plus Jakarta Sans: ${EMBEDDED_LINE}`,
      `Barlow Condensed: ${EMBEDDED_LINE}`,
      `Barlow Condensed: ${EMBEDDED_LINE}`,
      "Sertifikat Penghargaan",
      "Åsa Ørsted — Zoë Müller — Đặng",
      "Helvetica next to embedded fonts",
    ],
  ],
  build(env) {
    const { PdfDocument, PageSizes, StandardFonts, rgb, gray } = env.core;
    const doc = new PdfDocument({ deterministic: true, info: { title: "Fonts" } });
    const page = doc.addPage({ size: PageSizes.A5 });
    const c = page.content;
    const loaded = FONT_FILES.map((file) => new env.font.TrueTypeFont(env.fonts[file]));
    let y = page.height - 50;
    for (const font of loaded) {
      const line = `${font.familyName}: ${EMBEDDED_LINE}`;
      c.fillColor(gray(0)).font(font, 12).text(line, 30, y);
      c.strokeColor(rgb(1, 0, 0))
        .lineWidth(0.3)
        .rect(
          30,
          y - font.descent(12),
          font.widthOfText(line, 12),
          font.ascent(12) + font.descent(12),
        )
        .stroke();
      y -= 38;
    }
    const [inter, , jakarta, , barlowBold] = loaded as [
      Font.TrueTypeFont,
      Font.TrueTypeFont,
      Font.TrueTypeFont,
      Font.TrueTypeFont,
      Font.TrueTypeFont,
    ];
    const title = "Sertifikat Penghargaan";
    const size = 34;
    c.fillColor(rgb(0.1, 0.2, 0.5))
      .font(barlowBold, size)
      .text(title, (page.width - barlowBold.widthOfText(title, size)) / 2, y - 20);
    c.fillColor(gray(0.2))
      .font(jakarta, 13)
      .text("Åsa Ørsted — Zoë Müller — Đặng", 30, y - 60);
    c.font(StandardFonts.Helvetica, 11).text("Helvetica next to embedded fonts", 30, y - 90);
    // The same font used again must reuse its subset.
    c.font(inter, 9).text("Inter again, smaller: 0123456789", 30, y - 110);
    return doc.finish();
  },
};

export const samples: Readonly<Record<string, Sample>> = { shapes, text, report, fonts };
