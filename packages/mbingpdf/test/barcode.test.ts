/** One-dimensional barcodes: the patterns, and what real scanners make of them. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { type BarcodeType, barcode } from "../src/barcode/index.ts";
import { Barcode, Document, Font, inspect, Page, render } from "../src/index.ts";
import { readFont } from "./harness/env.ts";
import { encodePng, extractText, renderPdf, structureOutline } from "./harness/render.ts";

const inter = new Font(readFont("Inter-Variable"));
const hasZbar = spawnSync("zbarimg", ["--version"]).status === 0;
const hasZxing = spawnSync("ZXingReader", ["--version"]).status === 0;
const bits = (type: BarcodeType, value: string): string =>
  barcode(type, value)
    .modules.map((dark) => (dark ? "1" : "0"))
    .join("");

/** A picture of a code as a scanner would see it: a grey-scale PGM file. */
function picture(modules: readonly boolean[]): Uint8Array {
  const scale = 3;
  const quiet = 12;
  const height = 80;
  const width = (modules.length + quiet * 2) * scale;
  const row = new Uint8Array(width).fill(255);
  modules.forEach((dark, i) => {
    if (dark) row.fill(0, (quiet + i) * scale, (quiet + i + 1) * scale);
  });
  const pixels = new Uint8Array(width * height).fill(255);
  for (let y = 6; y < height - 6; y++) pixels.set(row, y * width);
  const header = new TextEncoder().encode(`P5\n${width} ${height}\n255\n`);
  const file = new Uint8Array(header.length + pixels.length);
  file.set(header);
  file.set(pixels, header.length);
  return file;
}

/** What a scanner reads in a picture, as `["CODE-128:value"]`. */
function scan(scanner: "zbar" | "zxing", image: Uint8Array, extension: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), "mbingpdf-barcode-"));
  try {
    const file = join(dir, `code.${extension}`);
    writeFileSync(file, image);
    if (scanner === "zbar") {
      const result = spawnSync("zbarimg", ["-q", "-Si25.enable", file], { encoding: "utf8" });
      return result.stdout.trim().split("\n").filter(Boolean).sort();
    }
    const result = spawnSync("ZXingReader", [file], { encoding: "utf8" });
    const texts = [...result.stdout.matchAll(/^Text:\s+"(.*)"$/gm)].map((match) => match[1]);
    const formats = [...result.stdout.matchAll(/^Format:\s+(.*)$/gm)].map((match) => match[1]);
    return texts.map((text, i) => `${formats[i]}:${text}`).sort();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const cases: [BarcodeType, string, string, string, string][] = [
  // type, value, text under the bars, zbar's answer, ZXing's answer
  ["code128", "BIB-0421", "BIB-0421", "CODE-128:BIB-0421", "Code 128:BIB-0421"],
  ["code128", "12345678", "12345678", "CODE-128:12345678", "Code 128:12345678"],
  ["code128", "123", "123", "CODE-128:123", "Code 128:123"],
  ["code128", "A1234567b", "A1234567b", "CODE-128:A1234567b", "Code 128:A1234567b"],
  [
    "code128",
    "9912345X678901",
    "9912345X678901",
    "CODE-128:9912345X678901",
    "Code 128:9912345X678901",
  ],
  [
    "code128",
    "Hello, World! ~",
    "Hello, World! ~",
    "CODE-128:Hello, World! ~",
    "Code 128:Hello, World! ~",
  ],
  ["ean13", "590123412345", "5901234123457", "EAN-13:5901234123457", "EAN-13:5901234123457"],
  ["ean13", "8991234567891", "8991234567891", "EAN-13:8991234567891", "EAN-13:8991234567891"],
  ["ean8", "9638507", "96385074", "EAN-8:96385074", "EAN-8:96385074"],
  // UPC-A is EAN-13 with a leading zero, and scanners report it that way.
  ["upca", "03600029145", "036000291452", "EAN-13:0036000291452", "EAN-13:0036000291452"],
  [
    "code39",
    "MBING-42 A/B+%$.",
    "MBING-42 A/B+%$.",
    "CODE-39:MBING-42 A/B+%$.",
    "Code 39:MBING-42 A/B+%$.",
  ],
  ["itf", "12345670", "12345670", "I2/5:12345670", "ITF:12345670"],
  ["itf14", "1540014128876", "15400141288763", "I2/5:15400141288763", "ITF:15400141288763"],
];

describe("barcode patterns", () => {
  test("EAN-13 is the pattern the standard gives", () => {
    // 5901234123457, the example every description of EAN-13 uses.
    expect(bits("ean13", "5901234123457")).toBe(
      "101" +
        "0001011" +
        "0100111" +
        "0110011" +
        "0010011" +
        "0111101" +
        "0011101" +
        "01010" +
        "1100110" +
        "1101100" +
        "1000010" +
        "1011100" +
        "1001110" +
        "1000100" +
        "101",
    );
    expect(bits("ean13", "590123412345")).toBe(bits("ean13", "5901234123457"));
    expect(bits("ean8", "96385074")).toHaveLength(67);
    expect(bits("upca", "036000291452")).toHaveLength(95);
  });

  test("Code 128 picks the shortest of its character sets", () => {
    // Start, one symbol per character, check symbol, stop: 11 modules each, 13 for the stop.
    const symbols = (value: string): number => (barcode("code128", value).modules.length - 13) / 11;
    expect(symbols("ABC")).toBe(1 + 3 + 1);
    // Digits pack two to a symbol.
    expect(symbols("12345678")).toBe(1 + 4 + 1);
    // Letters, a switch, three pairs of digits.
    expect(symbols("AB123456")).toBe(1 + 2 + 1 + 3 + 1);
    // An odd run gives up its first digit so that the rest pair up.
    expect(symbols("AB1234567")).toBe(1 + 3 + 1 + 3 + 1);
    // Too few digits to be worth switching for.
    expect(symbols("AB12")).toBe(1 + 4 + 1);
    // A tab needs set A; the lower-case letter after it needs set B again.
    expect(symbols("a\tb")).toBe(1 + 1 + 1 + 1 + 1 + 1 + 1);
    expect(barcode("code128", "a\tb").text).toBe("ab");
    // "PJJ123C": start B (104) and the weighted characters sum to 879, which leaves 55
    // after division by 103. Symbol 55 is drawn 3-1-1-3-2-1.
    expect(bits("code128", "PJJ123C").slice(-24, -13)).toBe("11101000110");
  });

  test("every code starts and ends with a bar", () => {
    for (const [type, value] of cases) {
      const { modules } = barcode(type, value);
      expect(modules[0]).toBe(true);
      expect(modules.at(-1)).toBe(true);
    }
  });

  test("check digits are worked out, and wrong ones refused", () => {
    expect(barcode("ean13", "899123456789").text).toBe("8991234567891");
    expect(barcode("itf14", "1540014128876").text).toBe("15400141288763");
    expect(() => barcode("ean13", "8991234567890")).toThrow(
      "The check digit of EAN-13 8991234567890 is wrong: it should be 1",
    );
    expect(() => barcode("ean13", "12345")).toThrow("EAN-13 takes 12 digits, or 13");
    expect(() => barcode("ean8", "12A4567")).toThrow("EAN-8 takes 7 digits");
    expect(() => barcode("upca", "1")).toThrow("UPC-A takes 11 digits");
  });

  test("values a code cannot hold are refused", () => {
    expect(() => barcode("code128", "naïve")).toThrow('Code 128 holds ASCII only; "ï" is not');
    expect(() => barcode("code128", "")).toThrow("needs a value");
    expect(() => barcode("code39", "lower")).toThrow('"l" is not one of them');
    expect(() => barcode("code39", "A*B")).toThrow('uses "*" to mark its ends');
    expect(() => barcode("itf", "123")).toThrow("an even number of digits");
    expect(() => barcode("nope" as BarcodeType, "1")).toThrow("Unknown barcode type");
  });
});

describe("scanners read the codes", () => {
  test.skipIf(!hasZbar).each(cases)("zbar: %s %s", (type, value, text, zbar) => {
    const code = barcode(type, value);
    expect(code.text).toBe(text);
    expect(scan("zbar", picture(code.modules), "pgm")).toEqual([zbar]);
  });

  test.skipIf(!hasZxing).each(cases)("ZXing: %s %s", (type, value, _text, _zbar, zxing) => {
    expect(scan("zxing", picture(barcode(type, value).modules), "pgm")).toEqual([zxing]);
  });

  test.skipIf(!hasZxing)("ZXing reads a control character back", () => {
    expect(scan("zxing", picture(barcode("code128", "a\tb").modules), "pgm")).toEqual([
      "Code 128:a\tb",
    ]);
  });
});

describe("the Barcode element", () => {
  const document = Document(
    { font: inter },
    Page(
      Barcode({ value: "BIB-0421" }),
      Barcode({ type: "ean13", value: "899123456789", barHeight: 30, moduleWidth: 1.2 }),
      Barcode({ type: "code39", value: "MBING-42", showText: false, quiet: 0 }),
    ),
  );

  test("is as wide as its modules and as tall as bars plus text", () => {
    const boxes = inspect(document)[0]?.boxes[0]?.children ?? [];
    // Code 128: start, 8 characters… "BIB-" then four digits as two pairs: 1+4+1+2+1 symbols.
    const modules = barcode("code128", "BIB-0421").modules.length;
    expect(boxes[0]).toMatchObject({ type: "Canvas", width: modules + 20, height: 36 + 2 + 8 });
    expect(boxes[1]).toMatchObject({ width: (95 + 20) * 1.2, height: 30 + 2 + 8 });
    expect(boxes[2]).toMatchObject({
      width: barcode("code39", "MBING-42").modules.length,
      height: 36,
    });
  });

  test("prints its value, and is a figure described by it", async () => {
    const pdf = await render(document, { tagged: true });
    expect((await extractText(pdf))[0]).toEqual(["BIB-0421", "8991234567891"]);
    expect((await structureOutline(pdf))[0]).toEqual([
      "Document",
      "  Figure [Barcode: BIB-0421]: BIB-0421",
      "  Figure [Barcode: 8991234567891]: 8991234567891",
      "  Figure [Barcode: MBING-42]",
    ]);
  });

  test("a bad value is an error where the element is made", () => {
    expect(() => Barcode({ type: "ean13", value: "abc" })).toThrow("EAN-13 takes 12 digits");
  });

  test.skipIf(!hasZbar || !hasZxing)("scans from the rendered page", async () => {
    const pages = await renderPdf("pdfium", await render(document), 2);
    const png = encodePng(pages[0] as (typeof pages)[number]);
    expect(scan("zbar", png, "png")).toEqual([
      "CODE-128:BIB-0421",
      "CODE-39:MBING-42",
      "EAN-13:8991234567891",
    ]);
    expect(scan("zxing", png, "png")).toEqual([
      "Code 128:BIB-0421",
      "Code 39:MBING-42",
      "EAN-13:8991234567891",
    ]);
  });
});
