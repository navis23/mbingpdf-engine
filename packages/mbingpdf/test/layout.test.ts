import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  Absolute,
  Box,
  Canvas,
  type Child,
  type DisplayItem,
  Document,
  Font,
  Grid,
  Image,
  LayoutError,
  Link,
  layoutDocument,
  mm,
  Page,
  PageBreak,
  Row,
  render,
  Spacer,
  Span,
  Stack,
  StandardFonts,
  Text,
} from "../src/index.ts";
import { readFont } from "./harness/env.ts";
import { extractText } from "./harness/render.ts";

const { Helvetica, HelveticaBold } = StandardFonts;
const photo = new Uint8Array(readFileSync(new URL("./images/photo.jpg", import.meta.url)));
const latin1 = (bytes: Uint8Array): string => new TextDecoder("latin1").decode(bytes);

/** A 200 × 300 page with a 10-point margin: a 180 × 280 content area starting at (10, 10). */
const page = (...children: Child[]) => Page({ size: [200, 300], margin: 10 }, ...children);
const pagesOf = (...children: Child[]) => layoutDocument(Document(page(...children))).pages;

type TextItem = Extract<DisplayItem, { type: "text" }>;
type PathItem = Extract<DisplayItem, { type: "path" }>;

/** Every text item on a page, including those inside groups. */
function texts(items: readonly DisplayItem[]): TextItem[] {
  return items.flatMap((item) =>
    item.type === "text" ? [item] : item.type === "group" ? texts(item.items) : [],
  );
}

/** The bounding box of a filled or stroked path. */
function bounds(item: PathItem): { x: number; y: number; width: number; height: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const command of item.commands) {
    for (let i = 1; i < command.length; i += 2) {
      xs.push(command[i] as number);
      ys.push(command[i + 1] as number);
    }
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

const fills = (items: readonly DisplayItem[]): ReturnType<typeof bounds>[] =>
  items
    .filter((item): item is PathItem => item.type === "path" && item.fill !== undefined)
    .map(bounds);

// Helvetica at 10 pt: ascent 7.18, descent 2.07, line height 11.5 (1.15 × size).
const LINE = 11.5;
const BASELINE = (LINE - (7.18 + 2.07)) / 2 + 7.18;

describe("elements", () => {
  test("take properties first, or none at all", () => {
    expect(Text("a", "b")).toEqual({ type: "Text", props: {}, children: ["a", "b"] });
    expect(Text({ size: 12 }, "a")).toEqual({ type: "Text", props: { size: 12 }, children: ["a"] });
    expect(Stack(Text("a")).children).toHaveLength(1);
    expect(Stack({ gap: 4 }, Text("a")).props).toEqual({ gap: 4 });
    expect(Spacer(8)).toEqual({ type: "Spacer", props: { size: 8 }, children: [] });
    expect(Box().type).toBe("Stack");
    expect(Link({ href: "https://example.com" }, "x").props.href).toBe("https://example.com");
  });

  test("empty values and nested lists of children are fine", () => {
    const items = ["satu", "dua"];
    const [first] = pagesOf(
      false,
      null,
      undefined,
      items.map((item) => Text(item)),
      0 > 1 && Text("never"),
    );
    expect(texts(first?.items ?? []).map((item) => item.text)).toEqual(["satu", "dua"]);
  });
});

describe("stacks", () => {
  test("children go one below another, with gap, padding and margin", () => {
    const [first] = pagesOf(
      Stack(
        { gap: 5, padding: [3, 4] },
        Text("satu"),
        Text({ margin: { top: 2, left: 6 } }, "dua"),
      ),
    );
    const [a, b] = texts(first?.items ?? []);
    expect(a).toMatchObject({ text: "satu", x: 14 });
    expect(a?.y).toBeCloseTo(10 + 3 + BASELINE);
    expect(b).toMatchObject({ text: "dua", x: 20 });
    expect(b?.y).toBeCloseTo(10 + 3 + LINE + 5 + 2 + BASELINE);
  });

  test("align moves children across the stack; stretch makes them fill it", () => {
    const width = Helvetica.widthOfText("teks", 10);
    const at = (align: "start" | "center" | "end" | "stretch") =>
      layoutDocument(Document(page(Stack({ align }, Text({ background: "#eeeeee" }, "teks")))))
        .pages[0]?.items ?? [];
    expect(fills(at("stretch"))[0]).toMatchObject({ x: 10, width: 180 });
    expect(fills(at("start"))[0]?.width).toBeCloseTo(width);
    expect(fills(at("center"))[0]?.x).toBeCloseTo(10 + (180 - width) / 2);
    expect(fills(at("end"))[0]?.x).toBeCloseTo(190 - width);
  });

  test("width, height and their limits", () => {
    const [first] = pagesOf(
      Box({ width: "50%", height: 40, background: "#ff0000" }),
      Box({ minHeight: 30, maxWidth: 60, background: "#00ff00" }, Text("x")),
    );
    const [a, b] = fills(first?.items ?? []);
    expect(a).toEqual({ x: 10, y: 10, width: 90, height: 40 });
    expect(b).toEqual({ x: 10, y: 50, width: 60, height: 30 });
  });

  test("text properties are inherited and can be overridden", () => {
    const doc = Document(
      { font: HelveticaBold, size: 14, color: "#112233" },
      page(Text("warisan"), Stack({ size: 8 }, Text({ color: "#ff0000" }, "ganti"))),
    );
    const [a, b] = texts(layoutDocument(doc).pages[0]?.items ?? []);
    expect(a).toMatchObject({
      font: HelveticaBold,
      size: 14,
      color: { space: "rgb", r: 0x11 / 255 },
    });
    expect(b).toMatchObject({
      font: HelveticaBold,
      size: 8,
      color: { space: "rgb", r: 1, g: 0, b: 0 },
    });
  });
});

describe("rows", () => {
  const cells = (...children: Child[]) =>
    fills(pagesOf(Row({ gap: 10 }, ...children))[0]?.items ?? []);

  test("children share the width by grow, basis and fixed widths", () => {
    const [a, b, c] = cells(
      Box({ grow: 1, background: "#ff0000", height: 10 }),
      Box({ grow: 3, background: "#00ff00", height: 10 }),
      Box({ width: 40, background: "#0000ff", height: 10 }),
    );
    // 180 wide, two gaps of 10, 40 fixed: 120 left, shared 1 : 3.
    expect(a).toMatchObject({ x: 10, width: 30 });
    expect(b).toMatchObject({ x: 50, width: 90 });
    expect(c).toMatchObject({ x: 150, width: 40 });
  });

  test("children shrink when there is too little room, but not below their content", () => {
    const word = Helvetica.widthOfText("takterpisahkan", 10);
    const [a, b] = cells(
      Box({ basis: 150, background: "#ff0000" }, Text("takterpisahkan")),
      Box({ basis: 150, background: "#00ff00" }, Text("a b c d e f g h i j k l m n o p")),
    );
    expect(a?.width).toBeCloseTo(85);
    expect(b?.width).toBeCloseTo(85);
    const [narrow, rest] = cells(
      Box({ basis: 150, background: "#ff0000" }, Text("takterpisahkan")),
      Box({ basis: 600, background: "#00ff00" }, Text("a b c d e f g h i j k l m n o p")),
    );
    expect(narrow?.width).toBeCloseTo(word);
    expect(rest?.width).toBeCloseTo(170 - word);
  });

  test("justify shares out spare width; a spacer takes it all", () => {
    const xs = (justify: "start" | "center" | "end" | "space-between" | "space-around"): number[] =>
      fills(
        pagesOf(
          Row(
            { justify },
            Box({ width: 20, height: 5, background: "#000000" }),
            Box({ width: 20, height: 5, background: "#000000" }),
          ),
        )[0]?.items ?? [],
      ).map((box) => box.x);
    expect(xs("start")).toEqual([10, 30]);
    expect(xs("center")).toEqual([80, 100]);
    expect(xs("end")).toEqual([150, 170]);
    expect(xs("space-between")).toEqual([10, 170]);
    expect(xs("space-around")).toEqual([45, 135]);
    const withSpacer = fills(
      pagesOf(
        Row(
          Box({ width: 20, height: 5, background: "#000000" }),
          Spacer(),
          Box({ width: 20, height: 5, background: "#000000" }),
        ),
      )[0]?.items ?? [],
    );
    expect(withSpacer.map((box) => box.x)).toEqual([10, 170]);
  });

  test("children line up across the row's height", () => {
    const ys = (align: "start" | "center" | "end" | "stretch") =>
      fills(
        pagesOf(
          Row(
            { align },
            Box({ width: 20, height: 40, background: "#000000" }),
            Box({ width: 20, background: "#000000" }, Spacer(10)),
          ),
        )[0]?.items ?? [],
      )[1];
    expect(ys("start")).toMatchObject({ y: 10, height: 10 });
    expect(ys("center")).toMatchObject({ y: 25, height: 10 });
    expect(ys("end")).toMatchObject({ y: 40, height: 10 });
    expect(ys("stretch")).toMatchObject({ y: 10, height: 40 });
  });
});

describe("text", () => {
  test("spans change the style inside a paragraph, and links become annotations", async () => {
    const doc = Document(
      page(
        Text(
          "Lihat ",
          Span({ font: HelveticaBold, color: "#ff0000" }, "ini"),
          " di ",
          Link({ href: "https://example.com/a" }, "situs kami"),
          ".",
        ),
      ),
    );
    const items = layoutDocument(doc).pages[0]?.items ?? [];
    expect(texts(items).map((item) => [item.text, item.font === HelveticaBold])).toEqual([
      ["Lihat ", false],
      ["ini", true],
      [" di ", false],
      ["situs kami", false],
      [".", false],
    ]);
    const link = items.find((item) => item.type === "link");
    expect(link).toMatchObject({ url: "https://example.com/a", y: 10, height: LINE });
    const pdf = await render(doc, { deterministic: true, compress: false });
    expect(latin1(pdf)).toContain("/URI(https://example.com/a)");
    // pdf.js reports the spaces between differently styled runs in its own way.
    expect((await extractText(pdf))[0]?.join("").replace(/\s+/g, "")).toBe("Lihatinidisituskami.");
  });

  test("align, wrapping and line feeds", () => {
    const width = Helvetica.widthOfText("kanan", 10);
    const [first] = pagesOf(Text({ align: "right" }, "kanan"), Text("baris satu\nbaris dua"));
    const [a, b, c] = texts(first?.items ?? []);
    expect(a?.x).toBeCloseTo(190 - width);
    expect([b?.text, c?.text]).toEqual(["baris satu", "baris dua"]);
    expect((c?.y ?? 0) - (b?.y ?? 0)).toBeCloseTo(LINE);
  });

  test("underline and strike-through draw a line under and through the text", () => {
    const [first] = pagesOf(
      Text({ underline: true }, "garis"),
      Text({ strikethrough: true }, "coret"),
    );
    const lines = fills(first?.items ?? []);
    expect(lines).toHaveLength(2);
    expect(lines[0]?.width).toBeCloseTo(Helvetica.widthOfText("garis", 10));
    expect(lines[0]?.y).toBeGreaterThan(10 + BASELINE);
    expect(lines[1]?.y).toBeLessThan(10 + LINE + BASELINE);
  });

  test("other elements cannot go inside text, nor spans outside it", () => {
    expect(() => pagesOf(Text("a", Stack()))).toThrow(/Text can only contain strings and Span/);
    expect(() => pagesOf(Span("a"))).toThrow(LayoutError);
  });
});

describe("pagination", () => {
  const line = (n: number) => Text(`baris ${n}`);
  const many = (count: number) => Array.from({ length: count }, (_value, i) => line(i + 1));

  test("content that does not fit continues on the next page", () => {
    // 280 points of height hold 24 lines of 11.5.
    const pages = pagesOf(...many(30));
    expect(pages).toHaveLength(2);
    expect(texts(pages[0]?.items ?? [])).toHaveLength(24);
    expect(texts(pages[1]?.items ?? []).map((item) => item.text)).toEqual(
      Array.from({ length: 6 }, (_value, i) => `baris ${i + 25}`),
    );
    expect(texts(pages[1]?.items ?? [])[0]?.y).toBeCloseTo(10 + BASELINE);
  });

  test("PageBreak and break before/after start new pages, but never leave a blank one", () => {
    const pages = pagesOf(
      PageBreak(),
      Text("satu"),
      PageBreak(),
      Text("dua"),
      Text({ break: "before" }, "tiga"),
      Text({ break: "after" }, "empat"),
      Text("lima"),
    );
    expect(pages.map((p) => texts(p.items).map((item) => item.text))).toEqual([
      ["satu"],
      ["dua"],
      ["tiga", "empat"],
      ["lima"],
    ]);
  });

  test("a long paragraph is split between lines, keeping two on each side", () => {
    const words = Array.from({ length: 40 }, (_value, i) => `kata${i}`).join("\n");
    // 22 lines fill most of the page, then a 40-line paragraph starts.
    const pages = pagesOf(...many(22), Text(words));
    const firstPage = texts(pages[0]?.items ?? []).map((item) => item.text);
    expect(firstPage.slice(-2)).toEqual(["kata0", "kata1"]);
    expect(texts(pages[1]?.items ?? [])[0]?.text).toBe("kata2");
    // With only one line of room, the paragraph starts on the next page instead (orphans).
    const tight = pagesOf(...many(23), Text(words));
    expect(texts(tight[0]?.items ?? []).at(-1)?.text).toBe("baris 23");
    expect(texts(tight[1]?.items ?? [])[0]?.text).toBe("kata0");
    // And a single last line is not left alone on the following page (widows).
    const three = pagesOf(...many(22), Text("a\nb\nc"));
    expect(texts(three[0]?.items ?? []).at(-1)?.text).toBe("baris 22");
    expect(texts(three[1]?.items ?? []).map((item) => item.text)).toEqual(["a", "b", "c"]);
    const relaxed = pagesOf(...many(22), Text({ widows: 1, orphans: 1 }, "a\nb\nc"));
    expect(
      texts(relaxed[0]?.items ?? [])
        .slice(-2)
        .map((item) => item.text),
    ).toEqual(["a", "b"]);
  });

  test("keepTogether moves a block whole; keepWithNext keeps a heading with what follows", () => {
    const block = (props: object) =>
      Stack(props, Text("blok a"), Text("blok b"), Text("blok c"), Text("blok d"));
    const split = pagesOf(...many(22), block({}));
    expect(texts(split[0]?.items ?? []).at(-1)?.text).toBe("blok b");
    const whole = pagesOf(...many(22), block({ keepTogether: true }));
    expect(texts(whole[0]?.items ?? []).at(-1)?.text).toBe("baris 22");
    expect(texts(whole[1]?.items ?? [])[0]?.text).toBe("blok a");
    expect(texts(pagesOf(...many(22), block({ break: "avoid" }))[1]?.items ?? [])[0]?.text).toBe(
      "blok a",
    );

    const heading = pagesOf(
      ...many(23),
      Text({ keepWithNext: true }, "Judul"),
      Text("isi a\nisi b\nisi c"),
    );
    expect(texts(heading[0]?.items ?? []).at(-1)?.text).toBe("baris 23");
    expect(
      texts(heading[1]?.items ?? [])
        .slice(0, 2)
        .map((item) => item.text),
    ).toEqual(["Judul", "isi a"]);
    const stranded = pagesOf(...many(23), Text("Judul"), Text("isi a\nisi b\nisi c"));
    expect(texts(stranded[0]?.items ?? []).at(-1)?.text).toBe("Judul");
  });

  test("a block taller than a page is split even when asked to stay together", () => {
    const pages = pagesOf(Stack({ keepTogether: true }, ...many(30)));
    expect(pages).toHaveLength(2);
    expect(texts(pages[0]?.items ?? [])).toHaveLength(24);
  });

  test("a box split across pages is open where it was cut", () => {
    const pages = pagesOf(
      ...many(20),
      Box({ border: { width: 1, color: "#ff0000" }, padding: 2 }, ...many(8)),
    );
    const strokes = (index: number) => fills(pages[index]?.items ?? []);
    // First part: top, left and right edges, running to the bottom of the page. No bottom edge.
    const firstPart = strokes(0);
    expect(firstPart).toHaveLength(3);
    expect(Math.max(...firstPart.map((edge) => edge.y + edge.height))).toBeCloseTo(290);
    // Second part: bottom, left and right, starting at the top of the page. No top edge.
    const secondPart = strokes(1);
    expect(secondPart).toHaveLength(3);
    expect(Math.min(...secondPart.map((edge) => edge.y))).toBeCloseTo(10);
  });

  test("columns of a row break at the same place", () => {
    const pages = pagesOf(
      Row({ gap: 10 }, Stack({ grow: 1 }, ...many(30)), Stack({ grow: 1 }, Text("pendek"))),
    );
    expect(pages).toHaveLength(2);
    expect(texts(pages[0]?.items ?? [])).toHaveLength(25);
    expect(texts(pages[1]?.items ?? []).map((item) => item.text)).toEqual(
      Array.from({ length: 6 }, (_value, i) => `baris ${i + 25}`),
    );
  });

  test("a row or image that does not fit in what is left moves on whole", () => {
    const row = pagesOf(
      ...many(23),
      Row(Box({ height: 30, width: 30, background: "#000000" }), Text("di samping")),
    );
    expect(texts(row[0]?.items ?? []).at(-1)?.text).toBe("baris 23");
    expect(fills(row[1]?.items ?? [])[0]).toMatchObject({ y: 10, height: 30 });
    const image = pagesOf(...many(20), Image({ src: photo, width: 120 }));
    expect(image[0]?.items.some((item) => item.type === "image")).toBe(false);
    expect(image[1]?.items.find((item) => item.type === "image")).toMatchObject({
      y: 10,
      width: 120,
      height: 80,
    });
  });

  test("a grid fills cells row by row and carries on over pages", () => {
    const cellsOf = (count: number) =>
      Array.from({ length: count }, (_value, i) => Text(`sel ${i + 1}`));
    const pages = pagesOf(
      Grid({ columns: 3, cell: { height: 50 }, gap: [10, 15] }, ...cellsOf(20)),
    );
    // 280 high: rows of 50 with 10 between, so four rows (230) fit, twelve cells a page.
    expect(pages.map((p) => texts(p.items).length)).toEqual([12, 8]);
    const first = texts(pages[0]?.items ?? []);
    const cellWidth = (180 - 2 * 15) / 3;
    expect(first[1]?.x).toBeCloseTo(10 + cellWidth + 15);
    expect((first[3]?.y ?? 0) - (first[0]?.y ?? 0)).toBeCloseTo(60);
    const limited = pagesOf(
      Grid({ columns: 2, rows: 2, cell: { height: 20, width: 40 } }, ...cellsOf(5)),
    );
    expect(limited.map((p) => texts(p.items).length)).toEqual([4, 1]);
  });

  test("an image taller than a page is scaled to fit it", () => {
    const [first, second] = pagesOf(Image({ src: photo, width: 600 }));
    expect(second).toBeUndefined();
    expect(first?.items.find((item) => item.type === "image")).toMatchObject({
      height: 280,
      width: 420,
    });
  });
});

describe("pages", () => {
  test("headers and footers repeat, and know the page number and the total", () => {
    const doc = Document(
      Page(
        {
          size: [200, 300],
          margin: 10,
          header: Text("Kepala"),
          footer: ({ page, pages }) => Text({ align: "center" }, `Halaman ${page} dari ${pages}`),
        },
        ...Array.from({ length: 50 }, (_value, i) => Text(`baris ${i + 1}`)),
      ),
    );
    const pages = layoutDocument(doc).pages;
    // 280 less a header and a footer line leaves 257: 22 lines a page.
    expect(pages).toHaveLength(3);
    pages.forEach((p, i) => {
      const items = texts(p.items);
      expect(items[0]).toMatchObject({ text: "Kepala", x: 10 });
      expect(items[0]?.y).toBeCloseTo(10 + BASELINE);
      expect(items.at(-1)?.text).toBe(`Halaman ${i + 1} dari 3`);
      expect(items.at(-1)?.y).toBeCloseTo(290 - LINE + BASELINE);
      expect(items[1]?.y).toBeCloseTo(10 + LINE + BASELINE);
    });
    expect(texts(pages[0]?.items ?? [])).toHaveLength(24);
  });

  test("each Page element has its own paper, and numbering runs through all of them", () => {
    const footer = ({ page, pages }: { page: number; pages: number }) => Text(`${page}/${pages}`);
    const doc = Document(
      Page({ size: "A4", footer }, Text("tegak")),
      Page(
        { size: "A5", orientation: "landscape", margin: mm(10), footer },
        Text("rebah"),
        PageBreak(),
        Text("lagi"),
      ),
      Page({ size: [100, 50], orientation: "portrait", margin: 5, footer }, Text("kecil")),
    );
    const pages = layoutDocument(doc).pages;
    expect(pages.map((p) => [Math.round(p.width), Math.round(p.height)])).toEqual([
      [595, 842],
      [595, 420],
      [595, 420],
      [50, 100],
    ]);
    expect(pages.map((p) => texts(p.items).at(-1)?.text)).toEqual(["1/4", "2/4", "3/4", "4/4"]);
    // The default margin is 20 mm.
    expect(texts(pages[0]?.items ?? [])[0]?.x).toBeCloseTo(mm(20));
  });

  test("loose content gets a default page, and an empty document still has one", () => {
    expect(layoutDocument(Document(Text("tanpa halaman"))).pages).toHaveLength(1);
    expect(layoutDocument(Document()).pages).toHaveLength(1);
    expect(layoutDocument(Document(Page({ size: "A6" }))).pages).toHaveLength(1);
  });

  test("backgrounds cover the sheet and sit behind the content", () => {
    const doc = Document(
      Page(
        {
          size: [200, 300],
          margin: 10,
          fill: "#fffbeb",
          background: Box({ background: "#e0f2fe", width: 200, height: 20 }),
        },
        Text("isi"),
      ),
    );
    const items = layoutDocument(doc).pages[0]?.items ?? [];
    expect(fills(items)[0]).toEqual({ x: 0, y: 0, width: 200, height: 300 });
    expect(fills(items)[1]).toEqual({ x: 0, y: 0, width: 200, height: 20 });
    expect(items.findIndex((item) => item.type === "text")).toBe(2);
  });

  test("margins that leave no room are an error", () => {
    expect(() => layoutDocument(Document(Page({ size: [100, 100], margin: 60 })))).toThrow(
      /no room/,
    );
  });
});

describe("absolute positioning", () => {
  test("measures from the edges of the parent, or of the page", () => {
    const [first] = pagesOf(
      Spacer(20),
      Box(
        { height: 100, background: "#eeeeee" },
        Absolute({ top: 5, left: 7 }, Box({ width: 10, height: 10, background: "#ff0000" })),
        Absolute({ bottom: 5, right: 7 }, Box({ width: 10, height: 10, background: "#00ff00" })),
        Absolute(
          { anchor: "page", top: 1, right: 2 },
          Box({ width: 10, height: 10, background: "#0000ff" }),
        ),
        Absolute({ left: 20, right: 20, top: 40 }, Box({ height: 4, background: "#000000" })),
      ),
    );
    const [, a, b, c, d] = fills(first?.items ?? []);
    expect(a).toEqual({ x: 17, y: 35, width: 10, height: 10 });
    expect(b).toEqual({ x: 173, y: 115, width: 10, height: 10 });
    expect(c).toEqual({ x: 188, y: 1, width: 10, height: 10 });
    expect(d).toEqual({ x: 30, y: 70, width: 140, height: 4 });
  });

  test("does not take up room, and can be rotated and faded", () => {
    const [first] = pagesOf(
      Absolute({ top: 50, left: 50, rotate: 45, opacity: 0.2 }, Text("STEMPEL")),
      Text("di bawahnya"),
    );
    const items = first?.items ?? [];
    expect(texts(items).find((item) => item.text === "di bawahnya")?.y).toBeCloseTo(10 + BASELINE);
    const group = items.find((item) => item.type === "group");
    expect(group).toMatchObject({ opacity: 0.2, rotate: { degrees: 45 } });
  });
});

describe("images and canvases", () => {
  test("an image keeps its proportions unless told otherwise", () => {
    const image = (props: object) =>
      pagesOf(Image({ src: photo, ...props }))[0]?.items.find((item) => item.type === "image");
    // The photo is 120 × 80 pixels: 90 × 60 points at 96 pixels per inch.
    expect(image({})).toMatchObject({ x: 10, y: 10, width: 90, height: 60 });
    expect(image({ width: 60 })).toMatchObject({ width: 60, height: 40 });
    expect(image({ height: 20 })).toMatchObject({ width: 30, height: 20 });
    expect(image({ width: "100%" })).toMatchObject({ width: 180, height: 120 });
    expect(image({ width: 60, height: 60 })).toMatchObject({ x: 10, y: 20, width: 60, height: 40 });
    expect(image({ width: 60, height: 60, fit: "fill" })).toMatchObject({ width: 60, height: 60 });
    const cover = image({ width: 60, height: 60, fit: "cover" });
    expect(cover).toMatchObject({
      x: -5,
      y: 10,
      width: 90,
      height: 60,
      clip: { x: 10, y: 10, width: 60, height: 60 },
    });
  });

  test("the same image used twice is embedded once", async () => {
    const pdf = await render(
      Document(page(Image({ src: photo, width: 50 }), Image({ src: photo, width: 30 }))),
      {
        deterministic: true,
        compress: false,
      },
    );
    expect(latin1(pdf).match(/\/Subtype\/Image/g)).toHaveLength(1);
  });

  test("a canvas draws in its own coordinates", () => {
    const [first] = pagesOf(
      Spacer(30),
      Canvas({
        width: 100,
        height: 40,
        margin: { left: 20 },
        draw: (g, size) => {
          g.rect(0, 0, size.width, size.height).fill("#ff0000");
          g.line(0, 0, 10, 10).stroke({ width: 2 });
        },
      }),
    );
    const paths = (first?.items ?? []).filter((item): item is PathItem => item.type === "path");
    expect(bounds(paths[0] as PathItem)).toEqual({ x: 30, y: 40, width: 100, height: 40 });
    expect(paths[1]?.stroke).toMatchObject({ width: 2 });
    expect(bounds(paths[1] as PathItem)).toEqual({ x: 30, y: 40, width: 10, height: 10 });
  });
});

describe("render", () => {
  const doc = Document({ title: "Uji", author: "mbingpdf", lang: "id" }, page(Text("Halo, dunia")));

  test("returns the bytes of a PDF, with the document's details", async () => {
    const pdf = await render(doc, { deterministic: true, compress: false });
    const out = latin1(pdf);
    expect(out.startsWith("%PDF-1.7")).toBe(true);
    expect(out).toContain("/Title(Uji)");
    expect(out).toContain("/Author(mbingpdf)");
    expect(out).toContain("/Lang(id)");
    expect(out).toContain("/MediaBox[0 0 200 300]");
    expect(await extractText(pdf)).toEqual([["Halo, dunia"]]);
  });

  test("the same document gives the same bytes when deterministic", async () => {
    expect(await render(doc, { deterministic: true })).toEqual(
      await render(doc, { deterministic: true }),
    );
    expect(render.sync(doc, { deterministic: true })).toEqual(
      await render(doc, { deterministic: true }),
    );
  });

  test("streams the same bytes", async () => {
    const chunks: Uint8Array[] = [];
    const reader = render.stream(doc, { deterministic: true }).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const joined = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }
    expect(joined).toEqual(await render(doc, { deterministic: true }));
  });

  test("reports characters no font can show, once", async () => {
    const warnings: string[] = [];
    await render(Document(page(Text("日本"), Text("日"))), {
      onWarning: (warning) => warnings.push(warning.message),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"日", "本"');
  });

  test("needs a Document", async () => {
    await expect(render(Text("x") as never)).rejects.toThrow(/needs a Document/);
  });

  test("embedded fonts, fallback and hyphenation work through the document API", async () => {
    const inter = new Font(readFont("Inter-Variable"));
    const pdf = await render(
      Document({ font: [inter, StandardFonts.ZapfDingbats], size: 11 }, page(Text("Lunas ✔ — é"))),
      { deterministic: true },
    );
    expect((await extractText(pdf))[0]?.join(" ").replace(/\s+/g, " ")).toContain("Lunas");
  });
});

describe("a long report (the M2 exit test)", () => {
  test("fifty pages of headings, paragraphs and images, with Page X of Y, and no coordinates", async () => {
    const inter = new Font(readFont("Inter-Variable"));
    const bold = inter.instance("Bold");
    const paragraph =
      "Dengan ini menerangkan bahwa pembayaran untuk keberangkatan rombongan telah diterima " +
      "sepenuhnya. Sertifikat penghargaan akan dikirimkan paling lambat empat belas hari setelah " +
      "kegiatan berakhir, bersama kuitansi resmi dan rincian biaya perjalanan. ";
    const sections = Array.from({ length: 130 }, (_value, i) => [
      Text(
        { font: bold, size: 14, keepWithNext: true, margin: { top: 6 } },
        `${i + 1}. Bagian laporan`,
      ),
      Text({ align: "justify" }, paragraph.repeat(3)),
      i % 4 === 0 &&
        Row(
          { gap: 12, keepTogether: true },
          Image({ src: photo, width: 120 }),
          Text({ grow: 1 }, paragraph),
        ),
      Text({ align: "justify" }, paragraph.repeat(2)),
    ]);
    const doc = Document(
      { title: "Laporan Tahunan", lang: "id", font: inter, size: 10, lineHeight: 1.5 },
      Page(
        {
          size: "A4",
          gap: 8,
          header: Text({ size: 8, color: "#6B7280" }, "Laporan Tahunan 2026"),
          footer: ({ page, pages }) =>
            Text({ size: 8, align: "center" }, `Page ${page} of ${pages}`),
        },
        Text({ font: bold, size: 28 }, "Laporan Tahunan"),
        sections,
      ),
    );

    const started = performance.now();
    const pdf = await render(doc, { deterministic: true });
    const elapsed = performance.now() - started;
    const pages = await extractText(pdf);
    expect(pages.length).toBeGreaterThanOrEqual(50);
    pages.forEach((runs, i) => {
      expect(runs.at(-1)).toBe(`Page ${i + 1} of ${pages.length}`);
      expect(runs[0]).toBe("Laporan Tahunan 2026");
    });
    // No heading is left as the last thing on a page.
    for (const runs of pages) expect(runs.at(-2)).not.toMatch(/^\d+\. Bagian laporan$/);
    const all = pages.flat().join(" ");
    for (let i = 1; i <= 130; i++) expect(all).toContain(`${i}. Bagian laporan`);
    // One font subset and one image, however many pages use them.
    expect(pdf.length).toBeLessThan(600_000);
    // Generous: this is a smoke check that layout is not quadratic, not a benchmark.
    expect(elapsed).toBeLessThan(15_000);
  });
});
