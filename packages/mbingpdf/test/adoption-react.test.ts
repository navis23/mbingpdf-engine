/** What the second app to adopt the library (a React one, six documents) found. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  Absolute,
  Document,
  Font,
  Heading,
  type InspectedBox,
  inspect,
  Page,
  render,
  Span,
  Stack,
  Table,
  TableRow,
  Text,
} from "../src/index.ts";
import { readFont } from "./harness/env.ts";

const inter = new Font(readFont("Inter-Variable"));
const hasPdftotext = spawnSync("pdftotext", ["-v"]).status === 0;

/** Every box on a page, flattened, with what kind of element it is. */
function flat(boxes: readonly InspectedBox[]): InspectedBox[] {
  return boxes.flatMap((box) => [box, ...flat(box.children ?? [])]);
}
const kinds = (boxes: readonly InspectedBox[]): string[] =>
  flat(boxes)
    .filter((box) => box.type === "Heading" || box.type === "Text")
    .map((box) => box.type);

describe("page furniture", () => {
  test("each page's content starts below that page's own header", () => {
    const body = Array.from({ length: 60 }, (_, i) => Text(`Line ${i + 1}`));
    for (const first of [null, Text({ size: 10 }, "small")]) {
      const pages = inspect(
        Document(
          Page(
            {
              size: "A5",
              margin: 30,
              header: ({ page }) => (page > 1 ? Text({ size: 40 }, "RUNNING HEAD") : first),
              footer: ({ page }) => (page > 1 ? Text({ size: 20 }, "foot") : null),
            },
            ...body,
          ),
        ),
      );
      expect(pages.length).toBeGreaterThan(1);
      const [, second] = pages;
      const [head, content, foot] = second?.boxes ?? [];
      expect(head?.y).toBe(30);
      expect(content?.y).toBeCloseTo((head?.y ?? 0) + (head?.height ?? 0), 3);
      // And it stops above that page's footer.
      expect((content?.y ?? 0) + (content?.height ?? 0)).toBeLessThanOrEqual((foot?.y ?? 0) + 1e-3);
      // The first page, with a small header or none, keeps all its room.
      const top = pages[0]?.boxes.at(first ? 1 : 0);
      expect(top?.y).toBeCloseTo(first ? 30 + (pages[0]?.boxes[0]?.height ?? 0) : 30, 3);
    }
  });

  test("the page background is part of what inspect() reports", () => {
    const [page] = inspect(
      Document(
        Page(
          { background: Absolute({ anchor: "page", top: 100, left: 40 }, Text("VOID")) },
          Text("x"),
        ),
      ),
    );
    const mark = flat(page?.boxes ?? []).find((box) => box.text?.includes("VOID"));
    expect(mark).toMatchObject({ x: 40, y: 100 });
  });
});

describe("a heading and what follows it", () => {
  const paragraph =
    "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor ".repeat(3);

  test("a heading alone in its box moves on with the paragraph that could not start", () => {
    for (const height of [470, 480, 490, 495, 500, 510]) {
      const pages = inspect(
        Document(
          Page(
            { size: "A5", margin: 30 },
            Stack({ height }),
            Stack({ gap: 6 }, Heading({ level: 2 }, "Section"), Text(paragraph)),
          ),
        ),
      );
      for (const page of pages) {
        // No page ends with the heading.
        expect(kinds(page.boxes).at(-1), `height ${height}`).not.toBe("Heading");
      }
    }
  });

  test("a box that moves on whole keeps its padding", () => {
    const pages = inspect(
      Document(
        Page(
          { size: "A5", margin: 30 },
          Stack({ height: 495 }),
          Stack({ padding: 10 }, Heading({ level: 2 }, "Section"), Text(paragraph)),
        ),
      ),
    );
    const moved = pages[1]?.boxes[0]?.children?.[0];
    expect(moved?.children?.[0]?.y).toBeCloseTo((moved?.y ?? 0) + 10, 3);
  });

  test("at the top of a page the heading stays: there is nowhere better", () => {
    const pages = inspect(
      Document(
        Page(
          { size: "A5", margin: 30 },
          Heading({ level: 2 }, "Section"),
          Stack({ height: 530, keepTogether: true }),
        ),
      ),
    );
    expect(kinds(pages[0]?.boxes ?? [])).toEqual(["Heading"]);
  });
});

describe("percentages inside an Absolute", () => {
  test('held at top and bottom it is as tall as the space between, and "100%" means that', async () => {
    const mark = (height: "100%" | "50%") =>
      Absolute(
        { anchor: "page", top: 20, left: 0, right: 0, bottom: 30 },
        Stack({ height, justify: "center" }, Text({ size: 80 }, "VOID")),
      );
    const size: [number, number] = [400, 600];
    await expect(
      render(Document(Page({ size, background: mark("100%") }, Text("x")))),
    ).resolves.toBeInstanceOf(Uint8Array);
    for (const [height, expected] of [
      ["100%", 550],
      ["50%", 275],
    ] as const) {
      const [page] = inspect(Document(Page({ size, background: mark(height) }, Text("x"))));
      const boxes = flat(page?.boxes ?? []);
      expect(boxes.some((box) => box.y === 20 && box.height === 550)).toBe(true);
      const inner = boxes.find((box) => box.type === "Stack" && box.height === expected);
      expect(inner, height).toMatchObject({ y: 20 });
      const text = boxes.find((box) => box.text?.includes("VOID"));
      // Centred in the stack.
      expect((text?.y ?? 0) + (text?.height ?? 0) / 2).toBeCloseTo(20 + expected / 2, 1);
    }
  });

  test("with nothing to be a percentage of, a percentage height is the content's", () => {
    const [page] = inspect(
      Document(Page(Table({ columns: [100], rows: [[Stack({ height: "100%" }, Text("cell"))]] }))),
    );
    const cell = flat(page?.boxes ?? []).find((box) => box.text?.includes("cell"));
    expect(Number.isFinite(cell?.height)).toBe(true);
  });
});

describe("text properties", () => {
  test("leading is a line height in points, on an element as in a theme", () => {
    const lines = "one\ntwo\nthree";
    const height = (props: object): number =>
      inspect(Document({ font: inter }, Page(Text({ size: 10, ...props }, lines))))[0]?.boxes[0]
        ?.children?.[0]?.height ?? 0;
    expect(height({ leading: 15 })).toBeCloseTo(45, 3);
    expect(height({ leading: 15 })).toBeCloseTo(height({ lineHeight: 1.5 }), 3);
    // lineHeight wins when both are given.
    expect(height({ leading: 15, lineHeight: 2 })).toBeCloseTo(60, 3);
  });

  test.skipIf(!hasPdftotext)("letter-spaced words are copied whole", async () => {
    const label = { size: 7, transform: "uppercase" } as const;
    const document = Document(
      { font: inter },
      Page(
        { size: "A5" },
        Text({ ...label, letterSpacing: 0.7 }, "Tanggal surat perjanjian"),
        Text({ ...label, letterSpacing: 2.5 }, "Invoice"),
        Text("Plain ", Span({ letterSpacing: 2 }, "wide words"), " here"),
      ),
    );
    for (const tagged of [false, true]) {
      const pdf = await render(document, { tagged, compress: false });
      const file = join(mkdtempSync(join(tmpdir(), "mbingpdf-")), "spaced.pdf");
      writeFileSync(file, pdf);
      const text = spawnSync("pdftotext", [file, "-"], { encoding: "utf8" }).stdout;
      // No space after a label: the space of a line break is not part of the spelled-out words.
      expect(text).not.toMatch(/[A-Z] \n/);
      expect(text.split(/\s*\n\s*/).filter(Boolean)).toEqual([
        "TANGGAL SURAT PERJANJIAN",
        "INVOICE",
        "Plain wide words here",
      ]);
      // The spacing is character spacing, not a gap after every glyph.
      const source = new TextDecoder("latin1").decode(pdf);
      expect(source).toContain("0.7 Tc");
      expect(source).toContain("/ActualText");
    }
  });

  test("letter spacing draws the same glyphs in the same places as before", async () => {
    const text = (props: object) =>
      Document({ font: inter }, Page({ size: [300, 60], margin: 10 }, Text(props, "Wide AV To")));
    const { renderPdf } = await import("./harness/render.ts");
    const spaced = await render(text({ letterSpacing: 3 }), { deterministic: true });
    const [page] = await renderPdf("pdfium", spaced, 2);
    const [plain] = await renderPdf("pdfium", await render(text({}), { deterministic: true }), 2);
    // Wider than unspaced text by nine gaps of 3 pt (the last glyph has none after it).
    const right = (pixels: Uint8Array, width: number): number => {
      let edge = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if ((pixels[i] as number) < 128) edge = Math.max(edge, (i / 4) % width);
      }
      return edge;
    };
    const gain =
      right(page?.pixels as Uint8Array, page?.width as number) -
      right(plain?.pixels as Uint8Array, plain?.width as number);
    expect(gain / 2).toBeCloseTo(27, 0);
  });
});

describe("tables", () => {
  test("an empty value in a row is an empty cell: the columns after it stay put", () => {
    const off = false as boolean;
    const [page] = inspect(
      Document(
        Page(
          { margin: 0 },
          Table({
            columns: [50, 50, 50],
            cellPadding: 0,
            rows: [["a", off && "b", "c"], TableRow("d", null, "f")],
          }),
        ),
      ),
    );
    const at = (text: string): number | undefined =>
      flat(page?.boxes ?? []).find((box) => box.text?.includes(text))?.x;
    expect([at("a"), at("c"), at("d"), at("f")]).toEqual([0, 100, 0, 100]);
  });
});
