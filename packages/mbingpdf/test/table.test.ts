import { describe, expect, test } from "vitest";
import {
  Cell,
  type Child,
  type DisplayItem,
  Document,
  layoutDocument,
  Page,
  Row,
  render,
  StandardFonts,
  Table,
  TableRow,
  Text,
} from "../src/index.ts";
import { extractText } from "./harness/render.ts";

const { Helvetica, HelveticaBold } = StandardFonts;
type TextItem = Extract<DisplayItem, { type: "text" }>;
type PathItem = Extract<DisplayItem, { type: "path" }>;

/** A 200 × 300 page with a 10-point margin: a 180 × 280 content area. */
const pagesOf = (...children: Child[]) =>
  layoutDocument(Document(Page({ size: [200, 300], margin: 10 }, ...children))).pages;
const texts = (items: readonly DisplayItem[]): TextItem[] =>
  items.filter((item): item is TextItem => item.type === "text");

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
const fills = (items: readonly DisplayItem[]) =>
  items
    .filter((item): item is PathItem => item.type === "path" && item.fill !== undefined)
    .map(bounds);

// Helvetica 10: a line is 11.5 high; with the default cell padding a row is 19.5.
const ROW = 11.5 + 8;
const plain = { borders: "none", cellPadding: 0 } as const;

describe("table columns", () => {
  const xs = (
    columns: Parameters<typeof Table>[0]["columns"],
    row: Child[] = ["a", "b", "c"],
  ): number[] =>
    texts(pagesOf(Table({ ...plain, columns, rows: [row] }))[0]?.items ?? []).map((item) => item.x);

  test("share the width equally by default", () => {
    expect(xs(3)).toEqual([10, 70, 130]);
  });

  test("fixed, percentage and fractional widths", () => {
    expect(xs([30, "50%", "1fr"])).toEqual([10, 40, 130]);
    expect(xs([{ width: "1fr" }, { width: "3fr" }, { width: 20 }])).toEqual([10, 50, 170]);
  });

  test("auto columns are as wide as their content", () => {
    const width = Helvetica.widthOfText("lebar", 10);
    const [a, b, c] = xs(["auto", "auto", "1fr"], ["lebar", "x", "sisa"]);
    expect(a).toBe(10);
    expect(b).toBeCloseTo(10 + width);
    expect(c).toBeCloseTo(10 + width + Helvetica.widthOfText("x", 10));
  });

  test("auto columns squeeze towards their longest word when space is short", () => {
    const long = "satu dua tiga empat lima enam tujuh delapan sembilan sepuluh sebelas";
    const pages = pagesOf(Table({ ...plain, columns: ["auto", "auto"], rows: [[long, long]] }));
    const second = texts(pages[0]?.items ?? []).find((item) => item.x > 50);
    expect(second?.x).toBeCloseTo(100);
  });

  test("a table without flexible columns is only as wide as its columns", () => {
    const [first] = pagesOf(
      Table({ columns: [40, 60], rows: [["a", "b"]], borders: { outer: { width: 1 } } }),
    );
    const outline = (first?.items ?? []).find(
      (item): item is PathItem => item.type === "path" && item.stroke !== undefined,
    );
    expect(outline && bounds(outline).width).toBeCloseTo(101);
  });

  test("column alignment and text style apply to the cells", () => {
    const [first] = pagesOf(
      Table({
        ...plain,
        columns: [
          { width: 90 },
          { width: 90, align: "end", font: HelveticaBold, color: "#ff0000" },
        ],
        rows: [["kiri", "kanan"]],
      }),
    );
    const [left, right] = texts(first?.items ?? []);
    expect(left?.x).toBe(10);
    expect(right?.x).toBeCloseTo(190 - HelveticaBold.widthOfText("kanan", 10));
    expect(right).toMatchObject({ font: HelveticaBold, color: { r: 1, g: 0, b: 0 } });
  });
});

describe("table cells", () => {
  test("numbers are text, and cells can hold any element", () => {
    const [first] = pagesOf(
      Table({ ...plain, columns: 2, rows: [[42, Row(Text("a"), Text("b"))]] }),
    );
    expect(texts(first?.items ?? []).map((item) => item.text)).toEqual(["42", "a", "b"]);
  });

  test("a cell can span columns, and then ignores the column's own style", () => {
    const [first] = pagesOf(
      Table({
        ...plain,
        columns: [{ width: 60, align: "right" }, 60, 60],
        rows: [
          ["a", "b", "c"],
          [Cell({ colSpan: 2, background: "#eeeeee" }, "dua"), "x"],
          [Cell({ colSpan: 3, align: "center" }, "tiga")],
        ],
      }),
    );
    const items = first?.items ?? [];
    expect(fills(items)[0]).toMatchObject({ x: 10, width: 120 });
    const byText = Object.fromEntries(texts(items).map((item) => [item.text, item.x]));
    expect(byText.dua).toBe(10);
    expect(byText.x).toBe(130);
    expect(byText.tiga).toBeCloseTo(10 + (180 - Helvetica.widthOfText("tiga", 10)) / 2);
  });

  test("padding, and where content sits in a taller row", () => {
    const [first] = pagesOf(
      Table({
        borders: "none",
        columns: 3,
        rows: [
          [
            "satu\ndua\ntiga",
            Cell({ verticalAlign: "middle" }, "tengah"),
            Cell({ verticalAlign: "bottom", padding: 0 }, "bawah"),
          ],
        ],
      }),
    );
    const byText = Object.fromEntries(texts(first?.items ?? []).map((item) => [item.text, item]));
    const baseline = (11.5 - (7.18 + 2.07)) / 2 + 7.18;
    // Default padding: 4 above, 6 at the side.
    expect(byText.satu).toMatchObject({ x: 16 });
    expect(byText.satu?.y).toBeCloseTo(10 + 4 + baseline);
    const rowHeight = 3 * 11.5 + 8;
    expect(byText.tengah?.y).toBeCloseTo(10 + (rowHeight - ROW) / 2 + 4 + baseline);
    expect(byText.bawah?.y).toBeCloseTo(10 + rowHeight - 11.5 + baseline);
  });

  test("rows can be styled, and every second row shaded", () => {
    const [first] = pagesOf(
      Table({
        ...plain,
        columns: 1,
        zebra: "#f0f0f0",
        rows: [
          ["a"],
          ["b"],
          TableRow({ background: "#ffeeee", font: HelveticaBold, height: 30 }, "c"),
          ["d"],
        ],
      }),
    );
    const items = first?.items ?? [];
    expect(fills(items)).toEqual([
      { x: 10, y: 10 + 11.5, width: 180, height: 11.5 },
      { x: 10, y: 10 + 23, width: 180, height: 30 },
      { x: 10, y: 10 + 53, width: 180, height: 11.5 },
    ]);
    expect(texts(items)[2]?.font).toBe(HelveticaBold);
  });
});

describe("table lines", () => {
  const table = (borders: Parameters<typeof Table>[0]["borders"]) =>
    pagesOf(
      Table({
        columns: 2,
        cellPadding: 0,
        ...(borders ? { borders } : {}),
        rows: [
          ["a", "b"],
          ["c", "d"],
          ["e", "f"],
        ],
      }),
    )[0]?.items ?? [];

  test("by default there is a hairline between rows", () => {
    const lines = fills(table(undefined));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ x: 10, width: 180, height: 0.5 });
    expect(lines[0]?.y).toBeCloseTo(10 + 11.5);
    expect(lines[1]?.y).toBeCloseTo(10 + 11.5 + 0.5 + 11.5);
  });

  test("a grid has lines between columns and a frame", () => {
    const items = table("grid");
    const vertical = fills(items).filter((line) => line.width === 0.5);
    expect(vertical).toHaveLength(3);
    expect(vertical[0]?.x).toBeCloseTo(10 + 0.5 + (180 - 1.5) / 2);
    expect(items.some((item) => item.type === "path" && item.stroke !== undefined)).toBe(true);
  });

  test("none, and lines chosen one by one", () => {
    expect(fills(table("none"))).toHaveLength(0);
    const custom = table({ horizontal: { width: 2, color: "#ff0000" }, vertical: { width: 1 } });
    expect(fills(custom).filter((line) => line.height === 2)).toHaveLength(2);
    expect(fills(custom).filter((line) => line.width === 1)).toHaveLength(3);
  });
});

describe("tables across pages", () => {
  const rows = (count: number): Child[][] =>
    Array.from({ length: count }, (_value, i) => [`baris ${i + 1}`]);
  const body = (items: readonly DisplayItem[]): string[] =>
    texts(items)
      .map((item) => item.text)
      .filter((text) => text.startsWith("baris"));

  test("rows flow onto new pages and the header repeats", () => {
    // 280 high, rows of 11.5: a header and 23 rows fit on a page.
    const pages = pagesOf(Table({ ...plain, columns: 1, header: ["Kepala"], rows: rows(50) }));
    expect(pages).toHaveLength(3);
    for (const page of pages) expect(texts(page.items)[0]?.text).toBe("Kepala");
    expect(pages.map((page) => body(page.items).length)).toEqual([23, 23, 4]);
    expect(body(pages[1]?.items ?? [])[0]).toBe("baris 24");
  });

  test("the header can be shown once only", () => {
    const pages = pagesOf(
      Table({ ...plain, columns: 1, header: ["Kepala"], repeatHeader: false, rows: rows(30) }),
    );
    expect(texts(pages[0]?.items ?? [])[0]?.text).toBe("Kepala");
    expect(texts(pages[1]?.items ?? [])[0]?.text).toBe("baris 24");
  });

  test("the footer follows the last row, or closes every page", () => {
    const once = pagesOf(Table({ ...plain, columns: 1, footer: ["Jumlah"], rows: rows(30) }));
    expect(texts(once[0]?.items ?? []).at(-1)?.text).toBe("baris 24");
    expect(texts(once[1]?.items ?? []).at(-1)?.text).toBe("Jumlah");
    const every = pagesOf(
      Table({ ...plain, columns: 1, footer: ["Jumlah"], repeatFooter: true, rows: rows(30) }),
    );
    expect(every.map((page) => texts(page.items).at(-1)?.text)).toEqual(["Jumlah", "Jumlah"]);
    expect(body(every[0]?.items ?? [])).toHaveLength(23);
  });

  test("a footer that does not fit after the last row moves to the next page with the header", () => {
    const pages = pagesOf(
      Table({ ...plain, columns: 1, header: ["Kepala"], footer: ["Jumlah"], rows: rows(23) }),
    );
    // The 23 rows fill the first page exactly, but the footer needs room too: the last row
    // waits for it rather than leaving the footer on its own.
    expect(pages).toHaveLength(2);
    expect(body(pages[0]?.items ?? [])).toHaveLength(22);
    expect(texts(pages[1]?.items ?? []).map((item) => item.text)).toEqual([
      "Kepala",
      "baris 23",
      "Jumlah",
    ]);
  });

  test("a row is never split, but a row taller than a page has to be", () => {
    const tall = Array.from({ length: 6 }, (_value, i) => `garis ${i + 1}`).join("\n");
    const pages = pagesOf(
      Text("x\n".repeat(20).trim()),
      Table({ ...plain, columns: 1, rows: [["awal"], [tall], ["akhir"]] }),
    );
    // 20 lines above, then "awal"; the six-line row does not fit in the three lines left.
    expect(texts(pages[0]?.items ?? []).at(-1)?.text).toBe("awal");
    expect(texts(pages[1]?.items ?? [])[0]?.text).toBe("garis 1");
    const huge = Array.from({ length: 40 }, (_value, i) => `garis ${i + 1}`).join("\n");
    const split = pagesOf(Table({ ...plain, columns: 2, rows: [[huge, "samping"]] }));
    expect(split).toHaveLength(2);
    expect(texts(split[1]?.items ?? [])[0]?.text).toBe("garis 25");
  });

  test("keepWithNext holds a group title to its first row", () => {
    const pages = pagesOf(
      Table({
        ...plain,
        columns: 1,
        rows: [...rows(23), TableRow({ keepWithNext: true }, "Kelompok B"), ["isi B"]],
      }),
    );
    expect(texts(pages[0]?.items ?? []).at(-1)?.text).toBe("baris 23");
    expect(texts(pages[1]?.items ?? []).map((item) => item.text)).toEqual(["Kelompok B", "isi B"]);
  });

  test("a table does not start with only its header at the bottom of a page", () => {
    const pages = pagesOf(
      Text("x\n".repeat(23).trim()),
      Table({ ...plain, columns: 1, header: ["Kepala"], rows: rows(3) }),
    );
    expect(texts(pages[0]?.items ?? []).some((item) => item.text === "Kepala")).toBe(false);
    expect(texts(pages[1]?.items ?? [])[0]?.text).toBe("Kepala");
  });

  test("a frame is left open where the table is cut", () => {
    const pages = pagesOf(
      Table({ columns: 1, cellPadding: 0, borders: { outer: { width: 1 } }, rows: rows(30) }),
    );
    // Split boxes draw their edges separately: three on each part.
    expect(
      fills(pages[0]?.items ?? []).filter((edge) => edge.width === 1 || edge.height === 1),
    ).toHaveLength(3);
    expect(
      fills(pages[1]?.items ?? []).filter((edge) => edge.width === 1 || edge.height === 1),
    ).toHaveLength(3);
  });
});

describe("a long table (the M3 exit test)", () => {
  test("a thousand rows with a repeated header, totals and page numbers", async () => {
    const rows = Array.from({ length: 1000 }, (_value, i) => [
      i + 1,
      `Transaksi nomor ${i + 1}${i % 13 === 0 ? " dengan keterangan yang lebih panjang dari biasanya" : ""}`,
      (i % 7) + 1,
      `Rp ${((i + 1) * 1250).toLocaleString("en-US").replace(/,/g, ".")}`,
    ]);
    const document = Document(
      { size: 9 },
      Page(
        {
          size: "A4",
          footer: ({ page, pages }) =>
            Text({ size: 7, align: "center" }, `Halaman ${page} dari ${pages}`),
        },
        Table({
          columns: [
            { width: 36, align: "end" },
            { width: "1fr" },
            { width: 40, align: "end" },
            { width: 90, align: "end" },
          ],
          header: ["No", "Keterangan", "Jml", "Nilai"],
          rows,
          footer: [[Cell({ colSpan: 3, align: "end" }, "Total"), "Rp 625.625.000"]],
          headerStyle: { font: HelveticaBold, background: "#F3F4F6" },
          zebra: "#FAFAFA",
        }),
      ),
    );
    const started = performance.now();
    const pdf = await render(document, { deterministic: true });
    const elapsed = performance.now() - started;
    const pages = await extractText(pdf);
    expect(pages.length).toBeGreaterThan(20);
    for (const page of pages) {
      expect(page.slice(0, 4)).toEqual(["No", "Keterangan", "Jml", "Nilai"]);
      expect(page.at(-1)).toMatch(/^Halaman \d+ dari \d+$/);
    }
    const all = pages.flat();
    expect(all.filter((text) => /^Transaksi nomor \d+/.test(text))).toHaveLength(1000);
    expect(all).toContain("Total");
    expect(all).toContain("Rp 625.625.000");
    // Budget: a thousand rows in well under two seconds and half a megabyte.
    expect(elapsed).toBeLessThan(5000);
    expect(pdf.length).toBeLessThan(500_000);
  });
});
