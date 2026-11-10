import { describe, expect, test } from "vitest";
import {
  Box,
  type Child,
  Columns,
  type DisplayItem,
  Document,
  Heading,
  Link,
  layoutDocument,
  Page,
  PageBreak,
  render,
  StandardFonts,
  TableOfContents,
  Text,
} from "../src/index.ts";
import { renderSvg } from "../src/svg/index.ts";
import { extractText } from "./harness/render.ts";

const { Helvetica } = StandardFonts;
type TextItem = Extract<DisplayItem, { type: "text" }>;
const latin1 = (bytes: Uint8Array): string => new TextDecoder("latin1").decode(bytes);
const pagesOf = (...children: Child[]) =>
  layoutDocument(Document(Page({ size: [200, 300], margin: 10 }, ...children))).pages;
const texts = (items: readonly DisplayItem[]): TextItem[] =>
  items.filter((item): item is TextItem => item.type === "text");
const lines = (count: number, prefix = "baris"): string =>
  Array.from({ length: count }, (_value, i) => `${prefix} ${i + 1}`).join("\n");

describe("headings", () => {
  test("are larger than the text around them, by level", () => {
    const [first] = pagesOf(
      Heading("Satu"),
      Heading({ level: 2 }, "Dua"),
      Heading({ level: 3, size: 9 }, "Tiga"),
      Text("isi"),
    );
    expect(texts(first?.items ?? []).map((item) => [item.text, item.size])).toEqual([
      ["Satu", 20],
      ["Dua", 15],
      ["Tiga", 9],
      ["isi", 10],
    ]);
  });

  test("stay with the paragraph that follows", () => {
    const pages = pagesOf(Text(lines(23)), Heading({ level: 4 }, "Judul"), Text(lines(3, "isi")));
    expect(texts(pages[0]?.items ?? []).at(-1)?.text).toBe("baris 23");
    expect(
      texts(pages[1]?.items ?? [])
        .slice(0, 2)
        .map((item) => item.text),
    ).toEqual(["Judul", "isi 1"]);
    const loose = pagesOf(
      Text(lines(23)),
      Heading({ level: 4, keepWithNext: false }, "Judul"),
      Text(lines(3, "isi")),
    );
    expect(texts(loose[0]?.items ?? []).at(-1)?.text).toBe("Judul");
  });

  test("become the PDF's bookmarks, nested by level", async () => {
    const pdf = await render(
      Document(
        Page(
          { size: [200, 300], margin: 10 },
          Heading("Bab 1"),
          Heading({ level: 2 }, "Bagian 1.1"),
          Heading({ level: 3 }, "Rincian"),
          Heading({ level: 2, bookmark: "Bagian kedua" }, "Bagian 1.2 yang judulnya panjang"),
          PageBreak(),
          Heading("Bab 2"),
          Heading({ level: 2, bookmark: false }, "Tidak masuk"),
        ),
      ),
      { deterministic: true, compress: false },
    );
    const out = latin1(pdf);
    expect(out).toMatch(/\/Outlines \d+ 0 R/);
    expect(out).toContain("/PageMode/UseOutlines");
    const titles = [...out.matchAll(/\/Title\(([^)]*)\)/g)].map((match) => match[1]);
    expect(titles).toEqual(
      expect.arrayContaining(["Bab 1", "Bagian 1.1", "Rincian", "Bagian kedua", "Bab 2"]),
    );
    expect(titles).not.toContain("Tidak masuk");
    // Two chapters at the top; five bookmarks in all.
    expect(out).toMatch(/\/Type\/Outlines\/First \d+ 0 R\/Last \d+ 0 R\/Count 5/);
    // "Bab 1" has two sections under it, the first of which has one more level below.
    expect(out).toMatch(
      /\/Title\(Bab 1\)\/Parent \d+ 0 R\/Next \d+ 0 R\/First \d+ 0 R\/Last \d+ 0 R\/Count 3/,
    );
    expect(out).toMatch(
      /\/Title\(Bagian 1\.1\)\/Parent \d+ 0 R\/Next \d+ 0 R\/First \d+ 0 R\/Last \d+ 0 R\/Count 1/,
    );
    // A bookmark points at the top of its heading: 10 points down a 300-point page.
    expect(out).toMatch(
      /\/Title\(Bab 2\)\/Parent \d+ 0 R\/Prev \d+ 0 R\/Dest\[\d+ 0 R\/XYZ null 290 null\]/,
    );
  });

  test("a document without headings has no outline", async () => {
    const out = latin1(
      await render(Document(Page({ size: [100, 100], margin: 10 }, Text("x"))), {
        compress: false,
      }),
    );
    expect(out).not.toContain("/Outlines");
    expect(out).not.toContain("/PageMode");
  });
});

describe("links within the document", () => {
  test("point at an element's id, wherever it ends up", async () => {
    const pdf = await render(
      Document(
        Page(
          { size: [200, 300], margin: 10 },
          Text("Lihat ", Link({ to: "lampiran" }, "lampiran"), " di belakang."),
          PageBreak(),
          Box({ id: "lampiran", margin: { top: 40 } }, Text("Lampiran")),
        ),
      ),
      { deterministic: true, compress: false },
    );
    const out = latin1(pdf);
    expect(out).toMatch(/\/Subtype\/Link\/Rect\[[\d. ]+\]\/Border\[0 0 0\]\/Dest\/lampiran/);
    // The destination is on the second page, 50 points from its top.
    const pageRefs = [...out.matchAll(/\/Kids\[(\d+) 0 R (\d+) 0 R\]/g)][0];
    expect(out).toContain(`/Dests<</lampiran[${pageRefs?.[2]} 0 R/XYZ 10 250 null]>>`);
  });

  test("the preview links to the same place", () => {
    const pages = renderSvg(
      Document(
        Page(
          { size: [200, 300], margin: 10 },
          Text(Link({ to: "akhir" }, "ke akhir")),
          Box({ id: "akhir" }, Text("Akhir")),
        ),
      ),
    );
    expect(pages[0]).toContain('<a href="#akhir">');
    expect(pages[0]).toContain('<g id="akhir"');
  });
});

describe("table of contents", () => {
  const book = (...front: Child[]) =>
    Document(
      Page(
        { size: [200, 300], margin: 10 },
        ...front,
        Heading("Pendahuluan"),
        Text(lines(30)),
        Heading({ level: 2 }, "Latar belakang"),
        Text(lines(30)),
        Heading("Penutup"),
        Text("selesai"),
      ),
    );

  test("lists the headings with the pages they are on", async () => {
    const pdf = await render(
      book(Heading({ bookmark: false }, "Daftar Isi"), TableOfContents(), PageBreak()),
      {
        deterministic: true,
      },
    );
    const pages = await extractText(pdf);
    // The contents page comes first, so the chapters start on page 2.
    expect(pages[0]).toEqual([
      "Daftar Isi",
      "Pendahuluan",
      "2",
      "Latar belakang",
      "3",
      "Penutup",
      "4",
    ]);
    expect(pages[1]?.[0]).toBe("Pendahuluan");
    expect(pages[2]).toContain("Latar belakang");
    expect(pages[3]).toContain("Penutup");
  });

  test("its entries link to their headings", async () => {
    const out = latin1(
      await render(book(TableOfContents(), PageBreak()), { deterministic: true, compress: false }),
    );
    // Title and page number of each of three entries are links.
    expect(out.match(/\/Dest\/heading-\d/g)).toHaveLength(6);
    expect(out).toMatch(/\/Dests<<\/heading-1\[\d+ 0 R\/XYZ 10 290 null\]/);
  });

  test("levels, indentation and leaders", () => {
    const layout = layoutDocument(
      book(TableOfContents({ levels: [1, 1], leaders: false }), PageBreak()),
    );
    const entries = texts(layout.pages[0]?.items ?? []).map((item) => item.text);
    expect(entries).toEqual(["Pendahuluan", "2", "Penutup", "4"]);
    const nested = layoutDocument(book(TableOfContents({ indent: 20 }), PageBreak()));
    const items = texts(nested.pages[0]?.items ?? []);
    const byText = Object.fromEntries(items.map((item) => [item.text, item.x]));
    expect(byText.Pendahuluan).toBe(10);
    expect(byText["Latar belakang"]).toBe(30);
    // Page numbers are right-aligned at the edge of the content.
    const number = items.find((item) => item.text === "2");
    expect((number?.x ?? 0) + Helvetica.widthOfText("2", 10)).toBeCloseTo(190);
    // Dotted leaders are drawn between title and number.
    expect(
      nested.pages[0]?.items.some(
        (item) => item.type === "path" && item.stroke?.dash !== undefined,
      ),
    ).toBe(true);
  });

  test("page numbers stay right when the contents themselves push the pages along", async () => {
    // A contents list long enough to spill onto a second page, without a page break after it.
    const chapters = Array.from({ length: 30 }, (_value, i) => [
      Heading({ level: 2 }, `Bab ${i + 1}`),
      Text(lines(4)),
    ]);
    const pdf = await render(
      Document(Page({ size: [200, 300], margin: 10 }, TableOfContents(), chapters)),
      {
        deterministic: true,
      },
    );
    const pages = await extractText(pdf);
    // Read the page each chapter is listed on, then check the chapter is really there.
    const listed = new Map<string, number>();
    const contents = [...(pages[0] ?? []), ...(pages[1] ?? [])];
    for (let i = 0; i + 1 < contents.length; i++) {
      const title = contents[i] as string;
      if (
        /^Bab \d+$/.test(title) &&
        /^\d+$/.test(contents[i + 1] as string) &&
        !listed.has(title)
      ) {
        listed.set(title, Number(contents[i + 1]));
      }
    }
    expect(listed.size).toBe(30);
    for (const [title, page] of listed) {
      // The heading itself is the occurrence that is followed by body text, not by a number.
      const runs = pages[page - 1] ?? [];
      const found = runs.some((run, i) => run === title && runs[i + 1] === "baris 1");
      expect(found, `${title} on page ${page}`).toBe(true);
    }
  });
});

describe("columns", () => {
  test("text flows down one column and on into the next", () => {
    const [first] = pagesOf(Columns({ count: 2, gap: 20, balance: false }, Text(lines(30))));
    const items = texts(first?.items ?? []);
    // 280 points hold 24 lines; the other six go to the top of the second column.
    expect(items.filter((item) => item.x === 10)).toHaveLength(24);
    expect(items.filter((item) => item.x === 110)).toHaveLength(6);
    expect(items[24]?.text).toBe("baris 25");
    expect(items[24]?.y).toBeCloseTo(items[0]?.y ?? 0);
  });

  test("columns are balanced where the content ends", () => {
    const [first] = pagesOf(Columns({ count: 2, gap: 20 }, Text(lines(10))), Text("sesudah"));
    const items = texts(first?.items ?? []);
    expect(items.filter((item) => item.x === 10 && item.text.startsWith("baris"))).toHaveLength(5);
    expect(items.filter((item) => item.x === 110 && item.text.startsWith("baris"))).toHaveLength(5);
    // What follows starts under the balanced columns, not under one long column.
    const after = items.find((item) => item.text === "sesudah");
    expect(after?.y).toBeLessThan(10 + 6 * 11.5 + 11.5);
  });

  test("content longer than a page of columns carries on over the page", () => {
    const pages = pagesOf(Columns({ count: 3, gap: 6 }, Text(lines(100))));
    expect(pages).toHaveLength(2);
    expect(texts(pages[0]?.items ?? [])).toHaveLength(72);
    // The remaining 28 lines are balanced over three columns.
    const second = texts(pages[1]?.items ?? []);
    expect(second).toHaveLength(28);
    expect(second[0]?.text).toBe("baris 73");
    expect(new Set(second.map((item) => Math.round(item.x))).size).toBe(3);
  });

  test("a rule can be drawn between columns, and children can be spaced", () => {
    const [first] = pagesOf(
      Columns(
        { count: 2, gap: 20, rule: { width: 1, color: "#ff0000" }, rowGap: 5 },
        Text("a"),
        Text("b"),
        Text("c"),
        Text("d"),
      ),
    );
    const rule = (first?.items ?? []).find(
      (item) => item.type === "path" && item.fill !== undefined,
    );
    expect(rule?.type === "path" && rule.commands[0]).toEqual(["M", 99.5, 10]);
    const items = texts(first?.items ?? []);
    expect((items[1]?.y ?? 0) - (items[0]?.y ?? 0)).toBeCloseTo(11.5 + 5);
    expect(items[2]?.x).toBe(110);
  });

  test("headings inside columns are bookmarked once", async () => {
    const out = latin1(
      await render(
        Document(
          Page(
            { size: [200, 300], margin: 10 },
            Columns(
              { count: 2 },
              Heading({ level: 3 }, "Satu"),
              Text(lines(6)),
              Heading({ level: 3 }, "Dua"),
              Text(lines(6)),
            ),
          ),
        ),
        { deterministic: true, compress: false },
      ),
    );
    expect([...out.matchAll(/\/Title\(([^)]*)\)/g)].map((match) => match[1])).toEqual([
      "Satu",
      "Dua",
    ]);
    expect(out).toMatch(/\/Dests<<\/heading-1\[[^\]]+\]\/heading-2\[[^\]]+\]>>/);
  });
});
