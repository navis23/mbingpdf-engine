import jsQR from "jsqr";
import { describe, expect, test } from "vitest";
import {
  type Child,
  type DisplayItem,
  Document,
  Font,
  List,
  layoutDocument,
  Page,
  QrCode,
  Row,
  render,
  Spacer,
  Stack,
  StandardFonts,
  Text,
} from "../src/index.ts";
import { listMarker } from "../src/layout/engine.ts";
import { readFont } from "./harness/env.ts";
import { pathBounds } from "./harness/geometry.ts";
import { extractText, renderPdf } from "./harness/render.ts";

const { Helvetica } = StandardFonts;
type TextItem = Extract<DisplayItem, { type: "text" }>;
type PathItem = Extract<DisplayItem, { type: "path" }>;
const pagesOf = (...children: Child[]) =>
  layoutDocument(Document(Page({ size: [200, 300], margin: 10 }, ...children))).pages;
const texts = (items: readonly DisplayItem[]): TextItem[] =>
  items.filter((item): item is TextItem => item.type === "text");
const widthOf = (item: TextItem): number =>
  (item.glyphs.reduce((sum, glyph) => sum + glyph.xAdvance, 0) * item.size) / item.font.unitsPerEm;

describe("lists", () => {
  test("markers for every numbering style", () => {
    expect([1, 2, 3].map((n) => listMarker("decimal", n))).toEqual(["1.", "2.", "3."]);
    expect([1, 26, 27, 52, 53].map((n) => listMarker("lower-alpha", n))).toEqual([
      "a.",
      "z.",
      "aa.",
      "az.",
      "ba.",
    ]);
    expect(listMarker("upper-alpha", 3)).toBe("C.");
    expect([1, 4, 9, 14, 40, 1994].map((n) => listMarker("lower-roman", n))).toEqual([
      "i.",
      "iv.",
      "ix.",
      "xiv.",
      "xl.",
      "mcmxciv.",
    ]);
    expect(listMarker("upper-roman", 8)).toBe("VIII.");
    expect(listMarker("disc", 5)).toBe("•");
    expect(listMarker("→", 5)).toBe("→");
  });

  test("items are indented past right-aligned markers", () => {
    const [first] = pagesOf(
      List({ marker: "decimal", start: 9 }, "sembilan", "sepuluh\nbaris kedua", "sebelas"),
    );
    const items = texts(first?.items ?? []);
    expect(items.map((item) => item.text)).toEqual([
      "9.",
      "sembilan",
      "10.",
      "sepuluh",
      "baris kedua",
      "11.",
      "sebelas",
    ]);
    const widest = Helvetica.widthOfText("10.", 10);
    // Markers end at the same place; item text starts half an em after it.
    expect((items[0]?.x ?? 0) + Helvetica.widthOfText("9.", 10)).toBeCloseTo(10 + widest);
    expect(items[2]?.x).toBeCloseTo(10);
    for (const index of [1, 3, 4, 6]) expect(items[index]?.x).toBeCloseTo(10 + widest + 5);
    // A marker sits on the first line of its item.
    expect(items[2]?.y).toBeCloseTo(items[3]?.y ?? 0);
  });

  test("bullets by default, any string, or a function", () => {
    const markers = (props: object): string[] =>
      texts(pagesOf(List(props, "a", "b"))[0]?.items ?? [])
        .map((item) => item.text)
        .filter((_text, i) => i % 2 === 0);
    expect(markers({})).toEqual(["•", "•"]);
    expect(markers({ marker: "-" })).toEqual(["-", "-"]);
    expect(markers({ marker: (n: number) => `(${n})` })).toEqual(["(1)", "(2)"]);
    expect(markers({ marker: "upper-roman", start: 3 })).toEqual(["III.", "IV."]);
  });

  test("lists nest, and an item with several parts is a Stack", () => {
    const [first] = pagesOf(
      List(
        { marker: "decimal", gap: 4 },
        "satu",
        // An item made of several parts is wrapped in a Stack; a bare array would be three items.
        Stack(
          Text("dua"),
          List({ marker: "lower-alpha" }, "dalam", Row(Text("kiri"), Spacer(), Text("kanan"))),
        ),
      ),
    );
    const items = texts(first?.items ?? []);
    expect(items.map((item) => item.text)).toEqual([
      "1.",
      "satu",
      "2.",
      "dua",
      "a.",
      "dalam",
      "b.",
      "kiri",
      "kanan",
    ]);
    expect(items[4]?.x).toBeGreaterThan(items[2]?.x ?? 0);
  });

  test("an item stays on one page unless told it may split", () => {
    const filler = Text("x\n".repeat(22).trim());
    const long = "baris a\nbaris b\nbaris c\nbaris d";
    const whole = pagesOf(filler, List("pendek", long));
    expect(texts(whole[0]?.items ?? []).at(-1)?.text).toBe("pendek");
    expect(texts(whole[1]?.items ?? [])[1]?.text).toBe("baris a");
    const split = pagesOf(
      filler,
      List({ splitItems: true, orphans: 1, widows: 1 }, "pendek", long),
    );
    expect(texts(split[0]?.items ?? []).at(-1)?.text).toBe("baris a");
  });
});

describe("text that fits its box", () => {
  const barlow = new Font(readFont("BarlowCondensed-Bold"));
  const lineOf = (...children: Child[]): TextItem =>
    texts(pagesOf(...children)[0]?.items ?? [])[0] as TextItem;

  test("shrinks to fill the width exactly, on one line", () => {
    const item = lineOf(
      Text({ font: barlow, size: 40, fit: true }, "Bartholomew Maximilian Wolfeschlegelstein"),
    );
    expect(item.size).toBeLessThan(40);
    expect(widthOf(item)).toBeCloseTo(180, 4);
    expect(
      pagesOf(
        Text({ font: barlow, size: 40, fit: true }, "Bartholomew Maximilian Wolfeschlegelstein"),
      )[0]?.items.filter((i) => i.type === "text"),
    ).toHaveLength(1);
  });

  test("stays at its size when it already fits, and is aligned as asked", () => {
    const item = lineOf(Text({ font: barlow, size: 20, fit: true, align: "center" }, "Ani"));
    expect(item.size).toBe(20);
    expect(item.x).toBeCloseTo(10 + (180 - barlow.widthOfText("Ani", 20)) / 2);
  });

  test("grows up to max, and stops shrinking at min", () => {
    const grown = lineOf(Text({ font: barlow, size: 10, fit: { max: 400 } }, "042"));
    expect(widthOf(grown)).toBeCloseTo(180, 4);
    expect(grown.size).toBeGreaterThan(100);
    const capped = lineOf(Text({ font: barlow, size: 10, fit: { max: 60 } }, "042"));
    expect(capped.size).toBe(60);
    const floored = lineOf(
      Text(
        { font: barlow, size: 40, fit: { min: 30, max: 40 } },
        "Bartholomew Maximilian Wolfeschlegelstein",
      ),
    );
    expect(floored.size).toBe(30);
    expect(widthOf(floored)).toBeGreaterThan(180);
  });

  test("letter spacing is kept as it is while the letters shrink", () => {
    const item = lineOf(
      Text({ font: barlow, size: 60, letterSpacing: 4, fit: true }, "SERTIFIKAT PENGHARGAAN"),
    );
    expect(widthOf(item)).toBeCloseTo(180, 4);
  });

  test("line feeds become spaces: the text is always one line", () => {
    const items = texts(
      pagesOf(
        Text({ font: barlow, size: 30, fit: true }, "Nama\nPanjang Sekali Sampai Menyusut"),
      )[0]?.items ?? [],
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.text).toBe("Nama Panjang Sekali Sampai Menyusut");
  });
});

describe("QR code element", () => {
  test("is a square of the size asked for, drawn as one path", () => {
    const [first] = pagesOf(QrCode({ value: "BIB:0421", size: 84, quiet: 0 }), Text("di bawah"));
    const paths = (first?.items ?? []).filter((item): item is PathItem => item.type === "path");
    expect(paths).toHaveLength(1);
    expect(pathBounds(paths[0] as PathItem)).toEqual({ x: 10, y: 10, width: 84, height: 84 });
    expect(texts(first?.items ?? [])[0]?.y).toBeGreaterThan(94);
  });

  test("leaves the quiet zone inside its size by default", () => {
    const [first] = pagesOf(QrCode({ value: "BIB:0421", size: 87 }));
    const path = (first?.items ?? []).find((item): item is PathItem => item.type === "path");
    const box = pathBounds(path as PathItem);
    const xs = [box.x, box.x + box.width];
    // Version 1 is 21 modules; with four quiet modules each side, 29 across: 3 points each.
    expect(Math.min(...xs)).toBeCloseTo(10 + 12);
    expect(Math.max(...xs)).toBeCloseTo(10 + 87 - 12);
  });

  test("scans from the rendered PDF", async () => {
    const value = "https://contoh.id/peserta/0421?kode=AbC123";
    const pdf = await render(
      Document(Page({ size: [200, 200], margin: 20 }, QrCode({ value, size: 160, level: "Q" }))),
      { deterministic: true },
    );
    for (const renderer of ["pdfium", "pdfjs"] as const) {
      const [image] = await renderPdf(renderer, pdf, 2);
      expect(image).toBeDefined();
      if (!image) continue;
      const decoded = jsQR(new Uint8ClampedArray(image.pixels), image.width, image.height);
      expect(decoded?.data, renderer).toBe(value);
    }
    // A vector code is tiny: no image is embedded.
    expect(new TextDecoder("latin1").decode(pdf)).not.toContain("/Subtype/Image");
    expect(await extractText(pdf)).toEqual([[]]);
  });

  test("colour and frame", () => {
    const [first] = pagesOf(
      QrCode({ value: "x", size: 50, color: "#1d4ed8", background: "#ffffff", padding: 5 }),
    );
    const paths = (first?.items ?? []).filter((item): item is PathItem => item.type === "path");
    expect(paths).toHaveLength(2);
    expect(paths[1]?.fill).toMatchObject({ space: "rgb", b: 0xd8 / 255 });
  });
});

describe("a batch of race bibs (the M3 exit test)", () => {
  test("five thousand bibs with numbers, names and QR codes in one file", async () => {
    const barlow = new Font(readFont("BarlowCondensed-Bold"));
    const jakarta = new Font(readFont("PlusJakartaSans-Variable"));
    const count = 5000;
    const bib = (n: number) =>
      Stack(
        { height: 420.9, padding: 22, border: { bottom: { width: 0.25, color: "#999999" } } },
        Row(
          { background: "#0b4ea2", padding: [6, 10], align: "center" },
          Text(
            { font: barlow, size: 20, color: "#ffffff", letterSpacing: 2 },
            "JAKARTA RIVERSIDE RUN 2026",
          ),
          Spacer(),
          Text({ color: "#ffffff", size: 10 }, "HALF MARATHON 21K"),
        ),
        Text(
          { font: barlow, size: 200, fit: { max: 230 }, align: "center", lineHeight: 0.95 },
          String(n).padStart(4, "0"),
        ),
        Row(
          { align: "end", gap: 12 },
          Stack(
            { grow: 1, gap: 2 },
            // Asking for the same style every time must not embed the font every time.
            Text(
              { font: jakarta.instance("Bold"), size: 18, fit: true },
              `Peserta Nomor ${n} Dengan Nama Panjang`,
            ),
            Text({ size: 10, color: "#555555" }, `Gelombang ${String.fromCharCode(65 + (n % 5))}`),
          ),
          QrCode({
            value: `https://contoh.id/bib/${n}?k=${(n * 7919).toString(36)}`,
            size: 74,
            quiet: 1,
          }),
        ),
      );
    const document = Document(
      { font: jakarta, size: 11 },
      Page(
        { size: "A4", margin: 0 },
        Array.from({ length: count }, (_value, i) => bib(i + 1)),
      ),
    );
    const started = performance.now();
    const pdf = await render(document, { deterministic: true });
    const elapsed = performance.now() - started;

    // Two bibs to a sheet: every page opens in a real PDF engine.
    const pages = await renderPdf("pdfium", pdf, 0.1);
    expect(pages).toHaveLength(count / 2);
    // Fonts are embedded once each: three subsets however many bibs there are.
    expect(pdf.length / count).toBeLessThan(2500);
    // Budget: a batch this size must stay practical on a server.
    expect(elapsed).toBeLessThan(60_000);
  }, 180_000);
});
