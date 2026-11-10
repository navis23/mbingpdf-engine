/**
 * Sample documents used by the structural, visual and cross-runtime checks.
 *
 * Each builder receives the library modules and the test fonts instead of importing them, so
 * the same file can be run against the source (in Vitest) and against the built package (on
 * Bun, Deno and in a browser). Only type-only imports are allowed here, and every sample must
 * be deterministic.
 */
import type * as Core from "../../src/core/index.ts";
import type * as FontModule from "../../src/font/index.ts";
import type * as Root from "../../src/index.ts";
import type * as Text from "../../src/text/index.ts";

export type CoreModule = typeof Core;

/** The TrueType-outline fonts in `test/fonts/`, without the `.ttf` extension. */
export const FONT_FILES = [
  "Inter-Variable",
  "JetBrainsMono-Variable",
  "PlusJakartaSans-Variable",
  "BarlowCondensed-Regular",
  "BarlowCondensed-Bold",
] as const;

/** A font with CFF outlines, in `test/fonts/` as an `.otf` file. */
export const CFF_FONT_FILE = "SourceSans3-Regular";

/** Every test font, with its file name. */
export const ALL_FONT_FILES: readonly FontFile[] = [...FONT_FILES, CFF_FONT_FILE];

export type FontFile = (typeof FONT_FILES)[number] | typeof CFF_FONT_FILE;

export function fontFileName(file: FontFile): string {
  return file === CFF_FONT_FILE ? `${file}.otf` : `${file}.ttf`;
}

/** Everything a sample may use. */
export interface SampleEnv {
  readonly core: CoreModule;
  readonly font: typeof FontModule;
  readonly text: typeof Text;
  /** The document-level API: the `mbingpdf` entry point. */
  readonly doc: typeof Root;
  /** A small JPEG for samples that show images. */
  readonly photo: Uint8Array;
  /** A CMYK output profile, for samples prepared for print. */
  readonly icc: Uint8Array;
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
      "Source Sans 3 (CFF): AVATAR office — é ß 0123",
      "Inter Thin — AVATAR Tokyo 0123",
      "Inter Bold — AVATAR Tokyo 0123",
      "Inter Black Display — AVATAR",
      "Jakarta ExtraLight — Wawasan",
      "Jakarta ExtraBold — Wawasan",
      "Mono ExtraBold: if (a != b) => {}",
    ],
  ],
  build(env) {
    const { PdfDocument, PageSizes, StandardFonts, rgb, gray } = env.core;
    const doc = new PdfDocument({ deterministic: true, info: { title: "Fonts" } });
    const page = doc.addPage({ size: PageSizes.A5 });
    const c = page.content;
    const loaded = FONT_FILES.map((file) => new env.font.Font(env.fonts[file]));
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
      FontModule.Font,
      FontModule.Font,
      FontModule.Font,
      FontModule.Font,
      FontModule.Font,
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

    // A font with CFF outlines, embedded as a CID-keyed CFF subset.
    const sourceSans = new env.font.Font(env.fonts[CFF_FONT_FILE]);
    c.font(sourceSans, 11).text("Source Sans 3 (CFF): AVATAR office — é ß 0123", 30, y - 130);

    // Styles cut from the variable fonts.
    y -= 160;
    const styles: [FontModule.Font, string][] = [
      [inter.instance({ wght: 100 }), "Inter Thin — AVATAR Tokyo 0123"],
      [inter.instance("Bold"), "Inter Bold — AVATAR Tokyo 0123"],
      [inter.instance({ wght: 900, opsz: 32 }), "Inter Black Display — AVATAR"],
      [jakarta.instance("ExtraLight"), "Jakarta ExtraLight — Wawasan"],
      [jakarta.instance("ExtraBold"), "Jakarta ExtraBold — Wawasan"],
      [(loaded[1] as FontModule.Font).instance({ wght: 800 }), "Mono ExtraBold: if (a != b) => {}"],
    ];
    for (const [font, line] of styles) {
      c.fillColor(gray(0)).font(font, 15).text(line, 30, y);
      c.strokeColor(rgb(1, 0, 0))
        .lineWidth(0.3)
        .rect(
          30,
          y - font.descent(15),
          font.widthOfText(line, 15),
          font.ascent(15) + font.descent(15),
        )
        .stroke();
      y -= 26;
    }
    return doc.finish();
  },
};

const INDONESIAN =
  "Dengan ini menerangkan bahwa pembayaran untuk keberangkatan rombongan telah diterima " +
  "sepenuhnya. Sertifikat penghargaan akan dikirimkan paling lambat empat belas hari setelah " +
  "kegiatan berakhir, bersama kuitansi resmi dan rincian biaya perjalanan.";
const ENGLISH =
  "Typography is the craft of arranging type so that written language is legible, readable " +
  "and appealing. Hyphenation and justification together decide how evenly a paragraph fills " +
  "its column.";

/** Paragraph layout: wrapping, alignment, justification, hyphenation, spacing, fallback. */
const paragraphs: Sample = {
  // The letter-spaced heading is left out: viewers report wide letter spacing as spaces.
  text: [
    [
      "Bartholomew Maximilian Wolfeschlegelstein",
      "rombongan telah diterima sepenuhnya.",
      "Typography is the craft of arranging type",
      "Rata kanan",
      "Total: Rp 1.250.000",
    ],
  ],
  build(env) {
    const { PdfDocument, PageSizes, StandardFonts, rgb, gray } = env.core;
    const { layoutParagraph, drawParagraph, fitText, hyphenateIndonesian, hyphenateEnglish } =
      env.text;
    const doc = new PdfDocument({ deterministic: true, info: { title: "Paragraphs" } });
    const page = doc.addPage({ size: PageSizes.A5 });
    const c = page.content;
    const inter = new env.font.Font(env.fonts["Inter-Variable"]);
    const jakarta = new env.font.Font(env.fonts["PlusJakartaSans-Variable"]);
    const barlowBold = new env.font.Font(env.fonts["BarlowCondensed-Bold"]);
    const left = 36;
    const width = page.width - 2 * left;
    let top = page.height - 36;

    /** Draws a paragraph inside a hairline box that shows the column it was laid out in. */
    const block = (layout: Text.ParagraphLayout, x = left, boxWidth = width): void => {
      c.strokeColor(gray(0.75))
        .lineWidth(0.3)
        .rect(x, top - layout.height, boxWidth, layout.height)
        .stroke();
      c.fillColor(gray(0.1));
      drawParagraph(c, layout, x, top);
      top -= layout.height + 12;
    };

    c.fillColor(rgb(0.1, 0.2, 0.5));
    const heading = layoutParagraph("Sertifikat", {
      font: barlowBold,
      size: 26,
      width,
      align: "center",
      transform: "uppercase",
      letterSpacing: 6,
    });
    drawParagraph(c, heading, left, top);
    top -= heading.height + 6;

    // A long name shrunk to fit the column exactly.
    const name = "Bartholomew Maximilian Wolfeschlegelstein";
    const fit = fitText(name, { font: jakarta.instance("Bold"), width, maxSize: 30, minSize: 8 });
    block(
      layoutParagraph(name, {
        font: jakarta.instance("Bold"),
        size: fit.size,
        width,
        align: "center",
      }),
    );

    block(layoutParagraph(INDONESIAN, { font: inter, size: 10, width, lineHeight: 1.45 }));
    block(
      layoutParagraph(INDONESIAN, {
        font: inter,
        size: 10,
        width,
        lineHeight: 1.45,
        align: "justify",
        hyphenate: hyphenateIndonesian,
      }),
    );

    // Two narrow columns side by side: justified with and without hyphenation.
    const column = (width - 14) / 2;
    const columnTop = top;
    const plain = layoutParagraph(ENGLISH, {
      font: StandardFonts.TimesRoman,
      size: 10,
      width: column,
      align: "justify",
    });
    block(plain, left, column);
    top = columnTop;
    const hyphenated = layoutParagraph(ENGLISH, {
      font: StandardFonts.TimesRoman,
      size: 10,
      width: column,
      align: "justify",
      hyphenate: hyphenateEnglish,
    });
    block(hyphenated, left + column + 14, column);
    top = columnTop - Math.max(plain.height, hyphenated.height) - 12;

    block(
      layoutParagraph("Rata kanan\nTotal: Rp 1.250.000\nPPN 11%: Rp 137.500", {
        font: inter.instance("Medium"),
        size: 10,
        width,
        align: "right",
        features: { tnum: true },
      }),
    );
    block(
      layoutParagraph("Lunas ✔ — ŵ é ✈ campuran fon", {
        font: [StandardFonts.Helvetica, StandardFonts.ZapfDingbats, inter],
        size: 12,
        width,
      }),
    );
    return doc.finish();
  },
};

const LOREM =
  "Dengan ini menerangkan bahwa pembayaran untuk keberangkatan rombongan telah diterima " +
  "sepenuhnya. Sertifikat penghargaan akan dikirimkan paling lambat empat belas hari setelah " +
  "kegiatan berakhir, bersama kuitansi resmi dan rincian biaya perjalanan. ";

/** A tour of the document API: every element, flowing over several pages. */
const tour: Sample = {
  text: [
    ["PT Contoh Sejahtera", "Ringkasan", "Judul di samping gambar", "Halaman 1 dari 5"],
    ["Halaman 2 dari 5"],
    ["Halaman 3 dari 5"],
    ["Kotak yang tidak terpisah", "Halaman 4 dari 5"],
    ["Label", "Peserta 20", "Halaman 5 dari 5"],
  ],
  build(env) {
    const d = env.doc;
    const inter = new d.Font(env.fonts["Inter-Variable"]);
    const bold = inter.instance("Bold");
    const document = d.Document(
      { title: "Laporan", lang: "id", font: inter, size: 10, lineHeight: 1.45 },
      d.Page(
        {
          size: "A5",
          margin: d.mm(15),
          gap: 8,
          header: d.Row(
            { border: { bottom: { width: 0.5, color: "#999999" } }, padding: [0, 0, 4, 0] },
            d.Text({ font: bold }, "PT Contoh Sejahtera"),
            d.Spacer(),
            d.Text({ color: "#666666" }, "Laporan Bulanan"),
          ),
          footer: ({ page, pages }) =>
            d.Text(
              { align: "center", size: 8, color: "#666666", padding: [6, 0, 0, 0] },
              `Halaman ${page} dari ${pages}`,
            ),
          background: d.Absolute(
            { anchor: "page", top: 250, left: 60, rotate: -30, opacity: 0.08 },
            d.Text({ font: bold, size: 70 }, "CONTOH"),
          ),
        },
        d.Text({ font: bold, size: 20, keepWithNext: true }, "Ringkasan"),
        d.Row(
          { gap: 10, align: "start" },
          d.Image({ src: env.photo, width: 90 }),
          d.Stack(
            { grow: 1, gap: 4 },
            d.Text({ font: bold }, "Judul di samping gambar"),
            d.Text({ hyphenate: d.hyphenateIndonesian, align: "justify" }, LOREM),
          ),
        ),
        d.Box(
          {
            background: "#eef2ff",
            padding: 8,
            radius: 4,
            border: { width: 0.5, color: "#6366f1" },
          },
          d.Text(
            "Catatan: ",
            d.Span({ font: bold, color: "#b91c1c" }, "penting"),
            " — lihat ",
            d.Link({ href: "https://example.com", color: "#1d4ed8" }, "example.com"),
            " untuk rincian, atau ",
            d.Span({ strikethrough: true }, "abaikan"),
            d.Span({ underline: true }, " baca ini"),
            ".",
          ),
        ),
        d.Row(
          { gap: 6 },
          d.Box({ background: "#fee2e2", padding: 6, grow: 1 }, d.Text("Satu")),
          d.Box(
            { background: "#dcfce7", padding: 6, grow: 2 },
            d.Text("Dua (dua kali lebih lebar)\nbaris kedua"),
          ),
          d.Box({ background: "#dbeafe", padding: 6, width: 60 }, d.Text("60 pt")),
        ),
        d.Row({ justify: "space-between" }, d.Text("kiri"), d.Text("tengah"), d.Text("kanan")),
        d.Canvas({
          width: "100%",
          height: 60,
          draw: (g, { width, height }) => {
            g.rect(0, 0, width, height).stroke({ color: "#999999", width: 0.5 });
            for (let i = 0; i < 8; i++) {
              const bar = 10 + ((i * 17) % 40);
              g.roundedRect(8 + i * 22, height - 6 - bar, 14, bar, 2).fill("#2563eb");
            }
            g.line(0, height / 2, width, height / 2).stroke({ color: "#ef4444", dash: [3, 2] });
            g.circle(width - 30, height / 2, 16).fillAndStroke("#fde68a", {
              color: "#b45309",
              width: 1.5,
            });
          },
        }),
        Array.from({ length: 5 }, (_value, i) => [
          d.Text({ font: bold, size: 13, keepWithNext: true }, `Bagian ${i + 1}`),
          d.Text({ hyphenate: d.hyphenateIndonesian, align: "justify" }, LOREM.repeat(2 + (i % 3))),
        ]),
        d.Box(
          {
            border: { left: { width: 3, color: "#f59e0b" } },
            background: "#fffbeb",
            padding: [6, 10],
            keepTogether: true,
          },
          d.Text({ font: bold }, "Kotak yang tidak terpisah"),
          d.Text(LOREM),
        ),
        d.PageBreak(),
        d.Text({ font: bold, size: 14 }, "Label"),
        d.Grid(
          { columns: 3, cell: { height: 40 }, gap: 6 },
          ...Array.from({ length: 20 }, (_value, i) =>
            d.Box(
              { border: { width: 0.5 }, padding: 4, height: 40 },
              d.Text({ size: 8 }, `Peserta ${i + 1}`),
              d.Absolute(
                { right: 3, bottom: 3 },
                d.Text({ size: 6, color: "#999999" }, `#${1000 + i}`),
              ),
            ),
          ),
        ),
      ),
    );
    return d.render.sync(document, { deterministic: true });
  },
};

/**
 * A finisher certificate prepared for a print shop: full-bleed artwork, a name that shrinks to
 * fit, CMYK and a spot colour, crop marks, and PDF/X-4 with an output intent.
 */
const certificate: Sample = {
  // The letter-spaced title is left out: viewers report wide letter spacing as spaces.
  text: [
    [
      "Diberikan kepada",
      "Bartholomew Maximilian Wolfeschlegelstein",
      "Half Marathon 21K",
      "01:47:32",
    ],
  ],
  build(env) {
    const d = env.doc;
    const jakarta = new d.Font(env.fonts["PlusJakartaSans-Variable"]);
    const bold = jakarta.instance("Bold");
    const barlow = new d.Font(env.fonts["BarlowCondensed-Bold"]);
    const brand = d.cmyk(0.9, 0.55, 0, 0.1);
    const gold = d.spot("PANTONE 871 C", d.cmyk(0.2, 0.3, 0.7, 0.15));
    const bleed = d.mm(3);
    const document = d.Document(
      {
        title: "Sertifikat Penyelesaian",
        lang: "id",
        font: jakarta,
        size: 11,
        color: d.cmyk(0, 0, 0, 0.85),
      },
      d.Page(
        {
          size: "A5",
          orientation: "landscape",
          margin: d.mm(14),
          bleed,
          marks: true,
          fill: d.cmyk(0.02, 0.02, 0.06, 0),
          gap: 6,
          // The background is laid out across the bleed, so the frame runs off the trimmed edge.
          background: d.Stack(
            { height: "100%" },
            d.Canvas({
              width: "100%",
              height: d.mm(148) + bleed * 2,
              draw: (g, { width, height }) => {
                // A band of colour that bleeds off three edges, and a faint pattern of rings.
                g.rect(0, 0, width, d.mm(22) + bleed).fill(brand);
                for (let i = 0; i < 9; i++) {
                  g.circle(width - 70, height - 60, 20 + i * 14).stroke({
                    color: d.cmyk(0.9, 0.55, 0, 0.1),
                    width: 0.6,
                  });
                }
                g.rect(
                  bleed + 14,
                  bleed + 14,
                  width - 2 * (bleed + 14),
                  height - 2 * (bleed + 14),
                ).stroke({ color: gold, width: 1.5 });
              },
            }),
          ),
        },
        d.Text(
          {
            font: barlow,
            size: 13,
            letterSpacing: 5,
            color: d.cmyk(0, 0, 0, 0),
            align: "center",
            margin: { top: -2 },
          },
          "SERTIFIKAT PENYELESAIAN",
        ),
        d.Spacer(d.mm(18)),
        d.Text({ align: "center", color: d.cmyk(0, 0, 0, 0.6) }, "Diberikan kepada"),
        d.Text(
          { font: bold, size: 34, fit: { min: 12, max: 34 }, align: "center", color: brand },
          "Bartholomew Maximilian Wolfeschlegelstein",
        ),
        d.Text({ align: "center" }, "atas keberhasilannya menyelesaikan"),
        d.Text({ font: barlow, size: 22, align: "center", color: gold }, "Half Marathon 21K"),
        d.Spacer(d.mm(6)),
        d.Row(
          { justify: "center", gap: d.mm(16), align: "center" },
          d.Stack(
            { align: "center" },
            d.Text({ size: 8, color: d.cmyk(0, 0, 0, 0.6) }, "WAKTU"),
            d.Text({ font: bold, size: 16, features: { tnum: true } }, "01:47:32"),
          ),
          d.QrCode({
            value: "https://contoh.id/sertifikat/0421",
            size: d.mm(18),
            quiet: 1,
            color: d.cmyk(0, 0, 0, 1),
          }),
          d.Stack(
            { align: "center" },
            d.Text({ size: 8, color: d.cmyk(0, 0, 0, 0.6) }, "NOMOR DADA"),
            d.Text({ font: bold, size: 16, features: { tnum: true } }, "0421"),
          ),
        ),
      ),
    );
    return d.render.sync(document, {
      deterministic: true,
      conformance: "PDF/X-4",
      outputIntent: {
        profile: env.icc,
        identifier: "CGATS TR 001",
        info: "U.S. Web Coated (SWOP) stand-in",
      },
    });
  },
};

const TERMS: readonly (readonly [string, string])[] = [
  [
    "Masa sewa",
    "Masa sewa dimulai pada tanggal dan jam serah terima dan berakhir pada tanggal dan jam pengembalian yang tertulis di halaman ini. Keterlambatan pengembalian dikenai biaya tambahan per jam sesuai tarif yang berlaku.",
  ],
  [
    "Pembayaran",
    "Penyewa membayar uang muka saat pemesanan dan melunasi sisanya sebelum serah terima. Uang jaminan dikembalikan setelah kendaraan diperiksa dan dinyatakan tidak ada kerusakan baru.",
  ],
  [
    "Penggunaan kendaraan",
    "Kendaraan hanya boleh dikemudikan oleh pengemudi yang terdaftar dan memiliki surat izin mengemudi yang masih berlaku. Kendaraan tidak boleh dipakai untuk balapan, menarik kendaraan lain, atau mengangkut barang berbahaya.",
  ],
  [
    "Bahan bakar",
    "Kendaraan diserahkan dengan tangki penuh dan dikembalikan dengan tangki penuh. Kekurangan bahan bakar ditagihkan sesuai harga pasar ditambah biaya layanan.",
  ],
  [
    "Kerusakan dan kehilangan",
    "Penyewa bertanggung jawab atas kerusakan yang terjadi selama masa sewa, kecuali yang tercatat dalam laporan pemeriksaan saat serah terima. Kehilangan kunci, surat kendaraan atau perlengkapan diganti sesuai biaya penggantian.",
  ],
  [
    "Asuransi",
    "Kendaraan dilindungi asuransi sesuai polis pemilik. Risiko sendiri untuk setiap kejadian menjadi tanggungan penyewa.",
  ],
  [
    "Pelanggaran lalu lintas",
    "Denda tilang, biaya parkir dan biaya tol selama masa sewa menjadi tanggungan penyewa, termasuk yang baru diketahui setelah kendaraan dikembalikan.",
  ],
  [
    "Pembatalan",
    "Pembatalan lebih dari tiga hari sebelum serah terima mendapat pengembalian uang muka penuh. Pembatalan kurang dari tiga hari dikenai potongan sebesar satu hari sewa.",
  ],
  [
    "Perpanjangan",
    "Perpanjangan masa sewa harus disetujui pemilik sebelum masa sewa berakhir dan dicatat sebagai tambahan pada perjanjian ini.",
  ],
  [
    "Penyelesaian perselisihan",
    "Perselisihan diselesaikan dengan musyawarah. Bila tidak tercapai mufakat, para pihak memilih domisili hukum di pengadilan negeri setempat.",
  ],
];

/** A hand-drawn signature, as SVG. */
const SIGNATURE = (seed: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 50"><path d="M6 ${34 + seed} C 22 ${4 + seed}, 30 ${46 - seed}, 44 24 S 62 ${8 + seed}, 74 30 S 96 44, 108 ${18 + seed} S 132 ${40 - seed}, 154 22" fill="none" stroke="#1e3a8a" stroke-width="2" stroke-linecap="round"/></svg>`;

/** A plan view of a car with numbered damage marks. */
const DAMAGE_DIAGRAM =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 110">' +
  '<rect x="20" y="20" width="200" height="70" rx="28" fill="#f3f4f6" stroke="#374151" stroke-width="1.5"/>' +
  '<rect x="62" y="30" width="46" height="50" rx="8" fill="#dbeafe" stroke="#374151"/>' +
  '<rect x="132" y="30" width="40" height="50" rx="8" fill="#dbeafe" stroke="#374151"/>' +
  '<g fill="#111827"><rect x="40" y="10" width="34" height="12" rx="4"/><rect x="166" y="10" width="34" height="12" rx="4"/>' +
  '<rect x="40" y="88" width="34" height="12" rx="4"/><rect x="166" y="88" width="34" height="12" rx="4"/></g>' +
  '<g fill="#dc2626" stroke="#ffffff" stroke-width="1.5"><circle cx="34" cy="40" r="7"/><circle cx="196" cy="84" r="7"/><circle cx="120" cy="22" r="7"/></g>' +
  "</svg>";

/**
 * A rental agreement with its inspection report: long numbered terms that never split, a
 * signature block that stays together, a field grid, a two-column section, a vector diagram,
 * a photo grid and a rotated stamp.
 */
const agreement: Sample = {
  text: [
    ["PERJANJIAN SEWA KENDARAAN", "Nomor PSK-2026-0412", "Masa sewa", "Halaman 1 dari 3"],
    ["Penyelesaian perselisihan", "Pihak Pertama", "Pihak Kedua", "Halaman 2 dari 3"],
    ["LAPORAN PEMERIKSAAN", "Lecet pada bumper depan kiri", "Halaman 3 dari 3"],
  ],
  build(env) {
    const d = env.doc;
    const inter = new d.Font(env.fonts["Inter-Variable"]);
    const mono = new d.Font(env.fonts["JetBrainsMono-Variable"]);
    const theme = d.defineTheme({
      fonts: { body: { variable: inter }, mono: { variable: mono } },
      colors: {
        text: "#111827",
        muted: "#6B7280",
        line: "#D1D5DB",
        brand: "#1E3A8A",
        danger: "#B91C1C",
      },
      text: {
        body: { font: "body", size: 9.5, leading: 14, color: "text" },
        h1: { font: "body", weight: 700, size: 15, leading: 20, color: "brand" },
        h2: { font: "body", weight: 600, size: 11, leading: 16 },
        label: { font: "body", size: 7.5, leading: 10, color: "muted" },
        value: { font: "body", weight: 500, size: 9.5, leading: 13 },
      },
    });
    const field = (label: string, value: string) =>
      d.Stack(
        { gap: 1 },
        d.Text({ style: "label", transform: "uppercase", letterSpacing: 0.4 }, label),
        d.Text({ style: "value" }, value),
      );
    const signature = (role: string, name: string, seed: number) =>
      d.Stack(
        { grow: 1, basis: 0, gap: 2 },
        d.Text({ style: "label" }, role),
        d.Svg({ src: SIGNATURE(seed), height: 36 }),
        d.Box(
          { border: { top: { width: 0.5, color: "line" } }, padding: [3, 0, 0, 0] },
          d.Text({ weight: 600 }, name),
        ),
      );
    const document = d.Document(
      { title: "Perjanjian Sewa Kendaraan", lang: "id", theme },
      d.Page(
        {
          size: "A4",
          margin: d.mm(14),
          gap: 10,
          header: d.Row(
            {
              align: "center",
              padding: [0, 0, 6, 0],
              border: { bottom: { width: 0.75, color: "brand" } },
            },
            d.Image({ src: env.photo, height: 22 }),
            d.Spacer(),
            d.Stack(
              { align: "end" },
              d.Text({ weight: 700, color: "brand" }, "Rental Contoh"),
              d.Text({ style: "label" }, "Jl. Merdeka No. 17, Bandung"),
            ),
          ),
          footer: ({ page, pages }) =>
            d.Row(
              { padding: [6, 0, 0, 0] },
              d.Text({ style: "label" }, "PSK-2026-0412"),
              d.Spacer(),
              d.Text({ style: "label" }, `Halaman ${page} dari ${pages}`),
            ),
          // A status stamp across every page.
          background: d.Absolute(
            { anchor: "page", top: 330, left: 150, rotate: -24, opacity: 0.16 },
            d.Box(
              { border: { width: 4, color: "danger" }, padding: [6, 22], radius: 6 },
              d.Text(
                { font: "body", weight: 800, size: 46, color: "danger", letterSpacing: 4 },
                "SALINAN",
              ),
            ),
          ),
        },
        d.Stack(
          { gap: 2, margin: { top: 4 } },
          d.Heading({ level: 1 }, "PERJANJIAN SEWA KENDARAAN"),
          d.Text({ color: "muted" }, "Nomor PSK-2026-0412"),
        ),
        d.Box(
          { background: "#F9FAFB", border: { width: 0.5, color: "line" }, radius: 4, padding: 10 },
          d.Grid(
            { columns: 3, cell: { height: 26 }, gap: [6, 12] },
            field("Penyewa", "Budi Santoso"),
            field("Kendaraan", "Minibus 7 kursi"),
            field("Nomor polisi", "D 1234 XYZ"),
            field("Serah terima", "12 Nov 2026, 08.00"),
            field("Pengembalian", "15 Nov 2026, 08.00"),
            field("Tarif per hari", "Rp 450.000"),
          ),
        ),
        d.Heading({ level: 2 }, "Ketentuan"),
        d.List(
          { marker: "decimal", gap: 7 },
          TERMS.map(([title, text]) =>
            d.Stack(
              { gap: 1 },
              d.Text({ weight: 600 }, title),
              d.Text({ align: "justify", hyphenate: d.hyphenateIndonesian }, `${text} ${text}`),
            ),
          ),
        ),
        d.Stack(
          { keepTogether: true, gap: 10, margin: { top: 6 } },
          d.Text(
            "Perjanjian ini dibuat rangkap dua dan ditandatangani oleh kedua pihak dalam keadaan sadar tanpa paksaan.",
          ),
          d.Row(
            { gap: 30 },
            signature("Pihak Pertama", "Siti Rahma", 0),
            signature("Pihak Kedua", "Budi Santoso", 6),
          ),
        ),
        d.PageBreak(),
        d.Heading({ level: 1 }, "LAPORAN PEMERIKSAAN"),
        d.Columns(
          { count: 2, gap: 18, rule: { width: 0.5, color: "line" }, rowGap: 8 },
          d.Heading({ level: 2 }, "Kondisi saat serah terima"),
          d.Table({
            columns: [{ width: "1fr" }, { width: "auto", align: "end", font: "mono", size: 8.5 }],
            rows: [
              ["Kilometer", "48.215"],
              ["Bahan bakar", "8/8"],
              ["Ban cadangan", "Ada"],
              ["Dongkrak dan kunci roda", "Ada"],
              ["Surat kendaraan", "Lengkap"],
            ],
            cellPadding: [3, 0],
          }),
          d.Heading({ level: 2 }, "Catatan kerusakan"),
          d.Svg({ src: DAMAGE_DIAGRAM, width: "100%" }),
          d.List(
            { marker: "decimal", gap: 3 },
            "Lecet pada bumper depan kiri",
            "Penyok kecil pada pintu belakang kanan",
            "Retak rambut pada kaca depan",
          ),
        ),
        d.Heading({ level: 2 }, "Foto"),
        d.Grid(
          { columns: 4, cell: { height: 78 }, gap: 6 },
          ["Depan", "Belakang", "Kiri", "Kanan"].map((side) =>
            d.Stack(
              { gap: 2 },
              d.Image({ src: env.photo, width: "100%", height: 62, fit: "cover" }),
              d.Text({ style: "label", align: "center" }, side),
            ),
          ),
        ),
      ),
    );
    return d.render.sync(document, { deterministic: true });
  },
};

/** The invoice from the API design. */
const invoice: Sample = {
  text: [["Invoice", "INV-0042", "Sewa bus pariwisata", "Total Rp 4.850.000", "Page 1 of 1"]],
  build(env) {
    const d = env.doc;
    const inter = new d.Font(env.fonts["Inter-Variable"]);
    const semiBold = inter.instance("SemiBold");
    const items: [string, number, number][] = [
      ["Sewa bus pariwisata", 1, 3_500_000],
      ["Tiket masuk rombongan", 30, 25_000],
      ["Makan siang", 30, 20_000],
    ];
    const money = (value: number): string =>
      `Rp ${value.toLocaleString("id-ID").replace(/,/g, ".")}`;
    const total = items.reduce((sum, [, quantity, price]) => sum + quantity * price, 0);
    const numbers = { features: { tnum: true } } as const;
    const document = d.Document(
      { title: "Invoice INV-0042", lang: "en", font: inter, size: 10, color: "#111827" },
      d.Page(
        {
          size: "A4",
          margin: d.mm(20),
          gap: 18,
          footer: ({ page, pages }) =>
            d.Text({ size: 8, color: "#6B7280", align: "center" }, `Page ${page} of ${pages}`),
        },
        d.Row(
          { justify: "space-between", align: "start" },
          d.Image({ src: env.photo, width: d.mm(40) }),
          d.Stack(
            { align: "end", gap: 2 },
            d.Text({ font: semiBold, size: 22 }, "Invoice"),
            d.Text({ color: "#6B7280" }, "INV-0042"),
          ),
        ),
        d.Row(
          { gap: 24 },
          d.Stack(
            { grow: 1, gap: 2 },
            d.Text({ size: 8, color: "#6B7280" }, "BILL TO"),
            d.Text({ font: semiBold }, "Yayasan Contoh"),
            d.Text("Jl. Merdeka No. 17\nBandung 40111"),
          ),
          d.Stack(
            { gap: 2 },
            d.Text({ size: 8, color: "#6B7280" }, "DATE"),
            d.Text("10 November 2026"),
          ),
        ),
        d.Table({
          columns: [
            { width: "1fr" },
            { width: 50, align: "end" },
            { width: 90, align: "end", ...numbers },
          ],
          header: ["Description", "Qty", "Amount"],
          rows: items.map(([name, quantity, price]) => [name, quantity, money(quantity * price)]),
          headerStyle: { font: semiBold, size: 9, background: "#F3F4F6" },
          cellPadding: [6, 8],
          borders: { horizontal: { width: 0.5, color: "#E5E7EB" } },
        }),
        d.Stack(
          { keepTogether: true, align: "end" },
          d.Text({ font: semiBold, size: 14, ...numbers }, `Total ${money(total)}`),
        ),
      ),
    );
    return d.render.sync(document, { deterministic: true });
  },
};

export const samples: Readonly<Record<string, Sample>> = {
  tour,
  invoice,
  certificate,
  agreement,
  shapes,
  text,
  report,
  fonts,
  paragraphs,
};
