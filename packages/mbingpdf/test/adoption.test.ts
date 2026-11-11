/** What the first real app to adopt the library found missing. */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  Box,
  Document,
  decodeImage,
  Font,
  inspect,
  layoutDocument,
  loadImage,
  Page,
  QrCode,
  Row,
  render,
  Spacer,
  Stack,
  Svg,
  Text,
} from "../src/index.ts";
import type { DisplayItem } from "../src/layout/display.ts";
import { previewPages, renderSvg } from "../src/svg/index.ts";
import { env, readFont } from "./harness/env.ts";
import { extractText, renderPdf } from "./harness/render.ts";

const inter = new Font(readFont("Inter-Variable"));

/** The y position of each child of the first box on the first page. */
const tops = (document: ReturnType<typeof Document>): number[] =>
  (inspect(document)[0]?.boxes[0]?.children ?? []).map((box) => box.y);

function items(document: ReturnType<typeof Document>): DisplayItem[] {
  const flat: DisplayItem[] = [];
  const visit = (list: readonly DisplayItem[]): void => {
    for (const item of list) {
      if (item.type === "group" || item.type === "tagged") visit(item.items);
      else flat.push(item);
    }
  };
  visit(layoutDocument(document).pages[0]?.items ?? []);
  return flat;
}

describe("placing content down a stack", () => {
  // Three lines of 20 points in a stack of 200: 140 to spare.
  const line = (text: string) => Text({ size: 10, lineHeight: 2 }, text);
  const stack = (props: Parameters<typeof Stack>[0]) =>
    Document(Page({ margin: 0 }, Stack(props as object, line("a"), line("b"), line("c"))));
  const inner = (document: ReturnType<typeof Document>): number[] =>
    (inspect(document)[0]?.boxes[0]?.children?.[0]?.children ?? []).map((box) => box.y);

  test("justify moves the children when the stack is taller than they are", () => {
    expect(inner(stack({ height: 200 }))).toEqual([0, 20, 40]);
    expect(inner(stack({ height: 200, justify: "center" }))).toEqual([70, 90, 110]);
    expect(inner(stack({ height: 200, justify: "end" }))).toEqual([140, 160, 180]);
    expect(inner(stack({ height: 200, justify: "space-between" }))).toEqual([0, 90, 180]);
    expect(inner(stack({ minHeight: 200, justify: "end" }))).toEqual([140, 160, 180]);
    // Padding stays outside the reckoning.
    expect(inner(stack({ height: 200, padding: 10, justify: "end" }))).toEqual([130, 150, 170]);
    // Nothing to spare, nothing to do.
    expect(inner(stack({ justify: "center" }))).toEqual([0, 20, 40]);
  });

  test("a spacer without a size takes the spare height", () => {
    const document = Document(
      Page({ margin: 0 }, Stack({ height: 200 }, line("atas"), Spacer(), line("bawah"))),
    );
    const boxes = inspect(document)[0]?.boxes[0]?.children?.[0]?.children ?? [];
    expect(boxes.map((box) => [box.y, box.height])).toEqual([
      [0, 20],
      [20, 160],
      [180, 20],
    ]);
    // A spacer with a size is still just that size.
    const fixed = Document(
      Page({ margin: 0 }, Stack({ height: 200 }, line("a"), Spacer(30), line("b"))),
    );
    expect(
      (inspect(fixed)[0]?.boxes[0]?.children?.[0]?.children ?? []).map((box) => box.y),
    ).toEqual([0, 20, 50]);
  });

  test("on a page: centre a certificate, or push a block to the bottom", () => {
    const centred = Document(
      Page({ size: [200, 300], margin: 20, justify: "center" }, line("tengah")),
    );
    // The body is 260 tall and the line 20: 120 above it, after the 20 of margin.
    expect(tops(centred)).toEqual([140]);
    const pushed = Document(
      Page({ size: [200, 300], margin: 20 }, line("atas"), Spacer(), line("bawah")),
    );
    expect(tops(pushed)).toEqual([20, 40, 260]);
    // Content that runs over the page is left as it flows.
    const long = Document(
      Page(
        { size: [200, 300], margin: 20, justify: "center" },
        Array.from({ length: 30 }, (_line, i) => line(`baris ${i}`)),
      ),
    );
    expect(inspect(long).length).toBeGreaterThan(1);
    expect(tops(long)[0]).toBe(20);
  });
});

describe("one line, cut short", () => {
  const long = "Bartholomew Maximilian Wolfeschlegelsteinhausenbergerdorff";
  const shown = (document: ReturnType<typeof Document>): string[] =>
    items(document).flatMap((item) => (item.type === "text" ? [item.text] : []));

  test("truncate ends the text with an ellipsis where it stops fitting", () => {
    const document = Document(
      { font: inter },
      Page({ margin: 0 }, Text({ truncate: true, width: 120 }, long)),
    );
    const [text] = shown(document);
    expect(text?.endsWith("…")).toBe(true);
    expect(long.startsWith((text as string).slice(0, -1))).toBe(true);
    const box = inspect(document)[0]?.boxes[0]?.children?.[0];
    expect(box?.height).toBeLessThan(15);
    const drawn = items(document).find((item) => item.type === "text") as Extract<
      DisplayItem,
      { type: "text" }
    >;
    const width =
      (drawn.glyphs.reduce((sum, glyph) => sum + glyph.xAdvance, 0) * 10) / inter.unitsPerEm;
    expect(width).toBeLessThanOrEqual(120);
    expect(width).toBeGreaterThan(105);
  });

  test("text that fits is left alone; line feeds become spaces", () => {
    expect(shown(Document(Page(Text({ truncate: true }, "pendek"))))).toEqual(["pendek"]);
    expect(shown(Document(Page(Text({ truncate: true }, "dua\nbaris"))))).toEqual(["dua baris"]);
  });

  test("a font without the ellipsis character gets three dots", async () => {
    const symbols = Document(Page({ margin: 0 }, Text({ truncate: true, width: 60 }, long)));
    // Helvetica has the character; the check is that the PDF is made and reads back.
    const text = (await extractText(await render(symbols)))[0]?.[0] ?? "";
    expect(text.endsWith("…") || text.endsWith("...")).toBe(true);
  });

  test("in a row it gives way instead of pushing its neighbour out", () => {
    const row = (props: object) =>
      Document(
        { font: inter },
        Page(
          { margin: 0, size: [200, 200] },
          Row({ gap: 10 }, Text(props, long), QrCode({ value: "x", size: 60 })),
        ),
      );
    const widths = (document: ReturnType<typeof Document>): number[] =>
      (inspect(document)[0]?.boxes[0]?.children?.[0]?.children ?? []).map((box) => box.width);
    // Text that wraps keeps the width of its longest word, and the row overflows.
    expect((widths(row({}))[0] as number) + 70).toBeGreaterThan(200);
    // Text that is cut short or shrunk fits what is left.
    expect(widths(row({ truncate: true }))).toEqual([130, 60]);
    expect(widths(row({ fit: true }))).toEqual([130, 60]);
  });
});

describe("small things", () => {
  test('width and height take "auto", meaning "as usual"', () => {
    const document = Document(
      Page({ margin: 0, size: [200, 200] }, Box({ width: "auto", height: "auto" }, Text("isi"))),
    );
    expect(inspect(document)[0]?.boxes[0]?.children?.[0]).toMatchObject({ width: 200 });
    expect(() => inspect(Document(Page(Box({ width: "wide" as "auto" }, Text("x")))))).toThrow(
      'Not a length: "wide"',
    );
  });

  test("a border can be dashed, all round or on one side", async () => {
    const all = items(
      Document(
        Page({ margin: 0 }, Box({ border: { width: 1, color: "#000", dash: [3, 2] } }, Text("x"))),
      ),
    );
    expect(all.find((item) => item.type === "path" && item.stroke)).toMatchObject({
      stroke: { width: 1, dash: [3, 2] },
    });
    const one = items(
      Document(
        Page(
          { margin: 0, size: [100, 100] },
          Box(
            { height: 40, border: { bottom: { width: 2, dash: [4, 4] }, left: { width: 2 } } },
            Text("x"),
          ),
        ),
      ),
    );
    const paths = one.flatMap((item) => (item.type === "path" ? [item] : []));
    // The dashed side is a line along the middle of where the solid strip would be.
    expect(paths[0]).toMatchObject({
      commands: [
        ["M", 0, 39],
        ["L", 100, 39],
      ],
      stroke: { width: 2, dash: [4, 4] },
    });
    // The solid side is still a filled strip.
    expect(paths[1]).toMatchObject({ commands: [["R", 0, 0, 2, 40]] });
    expect(paths[1]?.stroke).toBeUndefined();
    const pdf = await render(
      Document(Page(Box({ border: { width: 1, dash: [3, 2] } }, Text("x")))),
      { compress: false },
    );
    expect(new TextDecoder("latin1").decode(pdf)).toContain("[3 2] 0 d");
  });

  test("an Svg can cover its box, cut off at the edges", async () => {
    // A wide drawing in a square box: red on the left half, blue on the right.
    const wide =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">' +
      '<rect width="100" height="100" fill="#ff0000"/><rect x="100" width="100" height="100" fill="#0000ff"/></svg>';
    const document = (fit: "contain" | "cover") =>
      Document(
        Page({ margin: 0, size: [100, 100] }, Svg({ src: wide, width: 100, height: 100, fit })),
      );
    const shared = (fit: "contain" | "cover") =>
      items(document(fit)).find((item) => item.type === "shared") as Extract<
        DisplayItem,
        { type: "shared" }
      >;
    expect(shared("contain")).toMatchObject({ x: 0, y: 25, scale: 0.5 });
    expect(shared("contain").clip).toBeUndefined();
    expect(shared("cover")).toMatchObject({
      x: -50,
      y: 0,
      scale: 1,
      clip: { x: 0, y: 0, width: 100, height: 100 },
    });
    // In the PDF: the box is filled edge to edge, red at the left, blue at the right.
    const [page] = await renderPdf("pdfium", await render(document("cover")), 1);
    const pixel = (x: number, y: number): number[] => {
      const rendered = page as NonNullable<typeof page>;
      const at = (y * rendered.width + x) * 4;
      return [...rendered.pixels.subarray(at, at + 3)];
    };
    expect(pixel(5, 5)).toEqual([255, 0, 0]);
    expect(pixel(94, 94)).toEqual([0, 0, 255]);
    expect(renderSvg(document("cover"))[0]).toContain("clip-path=");
  });

  test("monochrome draws a whole Svg in the element's colour", () => {
    const logo =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
      '<rect width="5" height="10" fill="#000"/><path d="M5 0h5v10" stroke="#123456" fill="none"/></svg>';
    const colours = (props: object): unknown[] => {
      const shared = items(Document(Page(Svg({ src: logo, width: 20, ...props })))).find(
        (item) => item.type === "shared",
      ) as Extract<DisplayItem, { type: "shared" }>;
      return shared.items.flatMap((item) =>
        item.type === "path" ? [item.fill ?? item.stroke?.color] : [],
      );
    };
    const red = { space: "rgb", r: 1, g: 0, b: 0 };
    expect(colours({ color: "#ff0000" })).toEqual([
      { space: "rgb", r: 0, g: 0, b: 0 },
      expect.objectContaining({ space: "rgb" }),
    ]);
    expect(colours({ color: "#ff0000", monochrome: true })).toEqual([red, red]);
  });

  test("a preview page knows its text, for screen readers", () => {
    const logo =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
    const pages = previewPages(
      Document(
        Page(
          Text("Baris pertama"),
          Row(Text("kiri"), Text("kanan")),
          // A picture is read as its description; one without a description is not read.
          Row({ gap: 4 }, Text("Penyelenggara ·"), Svg({ src: logo, width: 10, alt: "Derap" })),
          Svg({ src: logo, width: 10 }),
          Text("Baris terakhir"),
        ),
      ),
    );
    expect(pages[0]?.text()).toBe(
      "Baris pertama\nkiri kanan\nPenyelenggara · Derap\nBaris terakhir",
    );
  });

  test("content a little too tall for a fixed height sticks out; the box is not split", () => {
    // Two plates of half a page each. A border takes half a point of the first one's height,
    // so its three parts no longer quite fit inside it.
    const half = 421;
    const plate = (border?: { bottom: { width: number } }) =>
      Stack(
        { height: half, keepTogether: true, ...(border ? { border } : {}) },
        Box({ height: 63 }),
        Box({ height: half - 152 }),
        Box({ height: 89 }, Text("kaki")),
      );
    const page = { size: [595, 842] as [number, number], margin: 0 };
    expect(inspect(Document(Page(page, plate(), plate())))).toHaveLength(1);
    const bordered = inspect(Document(Page(page, plate({ bottom: { width: 0.5 } }), plate())));
    expect(bordered).toHaveLength(1);
    const [first, second] = bordered[0]?.boxes[0]?.children ?? [];
    // The plate keeps its height, with all three parts in it; the next starts where it ends.
    expect(first).toMatchObject({ y: 0, height: half });
    expect(first?.children).toHaveLength(3);
    expect(second).toMatchObject({ y: half });
    // Content too tall for the page itself still breaks at the page.
    const tall = Document(
      Page(
        { size: [200, 200], margin: 0 },
        Stack(
          { height: 150 },
          Array.from({ length: 30 }, (_line, i) => Text(`baris ${i}`)),
        ),
      ),
    );
    expect(inspect(tall).length).toBeGreaterThan(1);
  });

  test("images the library cannot read say what to do about it", async () => {
    // The first bytes of a GIF file are enough to know it by.
    const gif = new TextEncoder().encode("GIF89a\x01\x00\x01\x00");
    expect(() => decodeImage(gif)).toThrow(
      "GIF images cannot be read directly: only JPEG and PNG can. In a browser, `await loadImage(bytes)`",
    );
    // Node has no image decoder to hand it to. (In Chromium this is checked by hand: it loads.)
    await expect(loadImage(gif)).rejects.toThrow(
      "GIF image cannot be read on this runtime: it has no image decoder of its own. Convert the image to PNG or JPEG first.",
    );
    // WebP is read by the library itself, on a server too (the app's note D).
    const webp = new Uint8Array(
      readFileSync(new URL("./images/webp/lossy-photo.webp", import.meta.url)),
    );
    expect(() => decodeImage(webp)).toThrow("WebP images are read by `await loadImage(bytes)`");
    expect(await loadImage(webp)).toMatchObject({ width: 120, height: 80, encoding: "raw" });
    // JPEG and PNG go the usual way, so loadImage can be used for every upload.
    const photo = await loadImage(env.photo);
    expect(photo).toMatchObject({ encoding: "jpeg" });
    expect(() => decodeImage(new Uint8Array([1, 2, 3]))).toThrow("Unsupported image format");
  });
});
