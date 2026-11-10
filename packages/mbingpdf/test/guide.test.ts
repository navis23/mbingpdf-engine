/**
 * The code samples of docs/guide/quick-start.md, as running code. If one of these has to
 * change, the guide has to change with it.
 */

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  Box,
  Cell,
  cmyk,
  Document,
  defineTheme,
  Font,
  Heading,
  hyphenateIndonesian,
  Image,
  inspect,
  Link,
  List,
  loadFont,
  mm,
  Page,
  PageBreak,
  QrCode,
  Row,
  render,
  Spacer,
  Span,
  Stack,
  StandardFonts,
  Svg,
  Table,
  TableOfContents,
  Text,
} from "../src/index.ts";
import { renderSvg } from "../src/svg/index.ts";
import { env, readFont } from "./harness/env.ts";
import { extractText } from "./harness/render.ts";

const inter = new Font(readFont("Inter-Variable"));

describe("quick start guide", () => {
  test("a first document", async () => {
    const pdf = await render(
      Document(
        { title: "Hello" },
        Page({ size: "A4" }, Text({ size: 24 }, "Hello, world"), Text("This is a PDF.")),
      ),
    );
    expect(pdf).toBeInstanceOf(Uint8Array);
    expect(await extractText(pdf)).toEqual([["Hello, world", "This is a PDF."]]);
    const paid = false;
    const items = ["a", "b"];
    expect(
      (
        await extractText(
          await render(
            Document(
              Page(
                paid && Text("Paid"),
                items.map((item) => Text(item)),
              ),
            ),
          ),
        )
      )[0],
    ).toEqual(["a", "b"]);
  });

  test("laying things out", async () => {
    const document = Document(
      Page(
        Row(
          { gap: 12, align: "center" },
          Text({ size: 18 }, "PT Contoh Sejahtera"),
          Spacer(),
          Stack({ align: "end" }, Text("Invoice"), Text({ color: "#6B7280" }, "INV-0042")),
        ),
        Box(
          {
            background: "#EEF2FF",
            padding: 8,
            radius: 4,
            border: { width: 0.5, color: "#6366F1" },
          },
          Text("A note in a box."),
        ),
        Box({ width: "50%", margin: mm(20) }, Text("half")),
      ),
    );
    expect((await extractText(await render(document)))[0]).toContain("A note in a box.");
  });

  test("text", async () => {
    const runner = { name: "Bartholomew Maximilian Wolfeschlegelstein" };
    const longParagraph =
      "Dengan ini menerangkan bahwa pembayaran telah diterima sepenuhnya. ".repeat(6);
    const document = Document(
      Page(
        Text(
          "Plain, with ",
          Span({ color: "#B91C1C" }, "a red word"),
          " and ",
          Link({ href: "https://example.com" }, "a link"),
          ".",
        ),
        Text({ align: "justify", hyphenate: hyphenateIndonesian }, longParagraph),
        Text({ size: 60, fit: true }, runner.name),
        Text("first line\nsecond line"),
      ),
    );
    const text = (await extractText(await render(document)))[0] ?? [];
    expect(text).toContain(runner.name);
    expect(text).toContain("second line");
  });

  test("fonts", async () => {
    const woff2Bytes = new Uint8Array(
      readFileSync(new URL("./fonts/BarlowCondensed-Regular.woff2", import.meta.url)),
    );
    const brand = await loadFont(woff2Bytes);
    const document = Document(
      { font: inter, size: 10 },
      Page(
        Text({ font: inter.instance("Bold") }, "A style cut from a variable font"),
        Text({ font: brand }, "From a WOFF2 file"),
        Text({ font: [inter, StandardFonts.ZapfDingbats] }, "Paid ✔"),
      ),
    );
    const warnings: string[] = [];
    await render(document, { onWarning: (warning) => warnings.push(warning.message) });
    expect(warnings).toEqual([]);
  });

  test("images, vector art and QR codes; tables and lists", async () => {
    const items = [{ name: "Bus", quantity: 1, total: 3_500_000 }];
    const money = (value: number): string => `Rp ${value}`;
    const total = 3_500_000;
    const svgMarkup =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';
    const document = Document(
      Page(
        Image({ src: env.photo, width: mm(40) }),
        Svg({ src: svgMarkup, width: 120 }),
        QrCode({ value: "https://example.com/t/0421", size: mm(25) }),
        Table({
          columns: [{ width: "1fr" }, { width: 50, align: "end" }, { width: 90, align: "end" }],
          header: ["Description", "Qty", "Amount"],
          rows: items.map((item) => [item.name, item.quantity, money(item.total)]),
          footer: [[Cell({ colSpan: 2, align: "end" }, "Total"), money(total)]],
          headerStyle: { background: "#F3F4F6" },
        }),
        List({ marker: "decimal" }, "First", "Second", "Third"),
      ),
    );
    const text = (await extractText(await render(document)))[0] ?? [];
    expect(text).toEqual(
      expect.arrayContaining(["Description", "Bus", "Total", "Rp 3500000", "3. Third"]),
    );
  });

  test("pages, breaks, headings and a table of contents", async () => {
    const content = [
      Heading({ level: 2 }, "Title"),
      Text("body"),
      PageBreak(),
      Text({ break: "before" }, "second page"),
    ];
    const document = Document(
      Page(
        {
          size: "A4",
          orientation: "landscape",
          margin: mm(20),
          gap: 10,
          header: Text("Annual report"),
          footer: ({ page, pages }) => Text({ align: "center" }, `Page ${page} of ${pages}`),
        },
        TableOfContents(),
        Stack({ keepTogether: true }, Text("kept")),
        Text({ keepWithNext: true, orphans: 3, widows: 3 }, "with next"),
        ...content,
      ),
    );
    const pages = await extractText(await render(document));
    // A page break followed by `break: "before"` is one break, not a blank page.
    expect(pages).toHaveLength(2);
    expect(pages[1]?.at(-1)).toBe("Page 2 of 2");
  });

  test("a theme", () => {
    const theme = defineTheme({
      fonts: { body: { variable: inter } },
      colors: { text: "#111827", muted: "#6B7280", brand: "#0F62FE" },
      text: {
        body: { font: "body", size: 10, leading: 14, color: "text" },
        h1: { font: "body", weight: 700, size: 22, leading: 28, color: "brand" },
        caption: { font: "body", size: 8, color: "muted" },
      },
    });
    const pages = inspect(
      Document(
        { theme },
        Page(Text({ style: "h1" }, "Invoice"), Text({ style: "caption" }, "INV-0042")),
      ),
    );
    expect(pages[0]?.boxes[0]?.children?.map((box) => box.height)).toEqual([28, 11.2]);
  });

  test("preview, print, and diagnostics", async () => {
    const document = Document(
      { font: inter },
      Page(
        { size: "A5", bleed: mm(3), marks: true, fill: cmyk(0.02, 0.02, 0.06, 0) },
        Text("siap cetak"),
      ),
    );
    expect(renderSvg(document)).toHaveLength(1);
    const pdf = await render(document, {
      conformance: "PDF/X-4",
      outputIntent: { profile: env.icc, identifier: "FOGRA39" },
      minImageDpi: 300,
      debug: true,
      strict: true,
      onWarning: (warning) => console.warn(warning.message, warning.path),
    });
    expect(pdf.length).toBeGreaterThan(1000);
    expect(inspect(document)[0]?.page).toBe(1);
  });
});
