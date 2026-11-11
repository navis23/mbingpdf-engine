# Quick start

mbingpdf turns a description of a document into a PDF. You say what is on the page; it works out where everything goes, including where pages break. It runs the same in a browser, on Node, Bun and Deno, and in a Web Worker.

> The package is not on npm yet. Until it is, install it from this repository.

## A first document

```ts
import { Document, Page, Text, render } from "mbingpdf";

const pdf = await render(
  Document(
    { title: "Hello" },
    Page({ size: "A4" }, Text({ size: 24 }, "Hello, world"), Text("This is a PDF.")),
  ),
);
// `pdf` is a Uint8Array: write it to a file, send it in a response, or offer it for download.
```

Every element is a function. Its first argument is an object of properties, which you can leave out; the rest are its children. Strings are text. `null`, `undefined` and `false` are skipped, so `paid && Text("Paid")` works, and arrays are flattened, so `items.map(...)` works.

Saving the result:

```ts
import { writeFile } from "node:fs/promises";
await writeFile("hello.pdf", pdf);                       // on a server

const url = URL.createObjectURL(new Blob([pdf], { type: "application/pdf" }));   // in a browser
```

## Laying things out

`Stack` puts its children one below another; `Row` puts them side by side. Both take `gap`, `padding`, `border`, `background` and `align`. In a row, `grow` shares out spare width and `Spacer()` takes all of it.

```ts
import { Box, Row, Spacer, Stack, Text } from "mbingpdf";

Row(
  { gap: 12, align: "center" },
  Text({ size: 18 }, "PT Contoh Sejahtera"),
  Spacer(),
  Stack({ align: "end" }, Text("Invoice"), Text({ color: "#6B7280" }, "INV-0042")),
);

Box({ background: "#EEF2FF", padding: 8, radius: 4, border: { width: 0.5, color: "#6366F1" } }, Text("A note in a box."));
```

Sizes are in points (72 to the inch). `mm()`, `cm()` and `inch()` convert: `margin: mm(20)`. Widths also take percentages: `width: "50%"`.

Text properties (`font`, `size`, `color`, `lineHeight`, `align` and so on) can be set on any element and apply to everything inside it.

## Text

```ts
import { Link, Span, Text, hyphenateIndonesian } from "mbingpdf";

Text("Plain, with ", Span({ color: "#B91C1C" }, "a red word"), " and ", Link({ href: "https://example.com" }, "a link"), ".");
Text({ align: "justify", hyphenate: hyphenateIndonesian }, longParagraph);
Text({ size: 60, fit: true }, runner.name);          // one line, shrunk to fit the width
```

A line feed in a string starts a new line.

## Fonts

Without a font, text is set in Helvetica, one of fourteen fonts every PDF viewer has built in (`StandardFonts`). They cover Western European languages, including English and Indonesian, and add nothing to the file.

For your own typeface, load the font file. TrueType and OpenType files (`.ttf`, `.otf`) work everywhere; WOFF2 works on a server (Node, Bun, Deno) but not in a browser, which has no way to unpack it for a script. Only the glyphs you use are embedded.

```ts
import { Font, loadFont } from "mbingpdf";

const inter = new Font(await readFile("Inter-Variable.ttf"));     // .ttf or .otf
const brand = await loadFont(woff2Bytes);                         // also reads .woff2, on a server

Document({ font: inter, size: 10 }, ...);
Text({ font: inter.instance("Bold") }, "A style cut from a variable font");
Text({ font: [inter, StandardFonts.ZapfDingbats] }, "Paid ✔");    // falls back per character
```

## Images, vector art and QR codes

```ts
import { Image, QrCode, Svg, loadImage } from "mbingpdf";

Image({ src: jpegOrPngBytes, width: mm(40) });        // height follows from the proportions
Image({ src: await loadImage(webpBytes), width: mm(40) });   // WebP and others, in a browser
Svg({ src: svgMarkup, width: 120 });                  // drawn as vectors, sharp at any size
QrCode({ value: "https://example.com/t/0421", size: mm(25) });
```

## Barcodes and charts

```ts
import { Barcode, BarChart, LineChart, PieChart } from "mbingpdf";

Barcode({ value: "BIB-0421" });                                  // Code 128: any plain text
Barcode({ type: "ean13", value: "899123456789" });               // the check digit is added

BarChart({ labels: ["Jan", "Feb", "Mar"], values: [12, 19, 7], title: "Pesanan" });
LineChart({
  labels: months,
  series: [{ name: "2025", values: lastYear }, { name: "2026", values: thisYear }],
  format: (value) => `Rp ${value} jt`,
});
PieChart({ data: [{ label: "Bus", value: 45 }, { label: "Minibus", value: 25 }], donut: true });
```

Both are vector drawings in the document's own font. A chart is as wide as its container and 180 points tall unless told otherwise; in a `Row`, give each chart `grow: 1, basis: 0` to share the width. A barcode is as wide as its bars need: a value the code cannot hold is an error when the element is made, not a label that will not scan.

For a drawing of your own, `Canvas` has the same tools the charts use, including text: `g.text("label", x, y, { align: "center" })` and `g.measureText("label")`.

## Tables and lists

```ts
import { Cell, List, Table } from "mbingpdf";

Table({
  columns: [{ width: "1fr" }, { width: 50, align: "end" }, { width: 90, align: "end" }],
  header: ["Description", "Qty", "Amount"],
  rows: items.map((item) => [item.name, item.quantity, money(item.total)]),
  footer: [[Cell({ colSpan: 2, align: "end" }, "Total"), money(total)]],
  headerStyle: { background: "#F3F4F6" },
});

List({ marker: "decimal" }, "First", "Second", "Third");
```

A table runs over as many pages as it needs, never splits a row, and repeats its header on each page.

## Pages

A `Page` is a run of pages of one size. Its children flow down the page and onto as many more as they need. `header` and `footer` repeat; given a function, they are told the page number and the total.

```ts
Page(
  {
    size: "A4",                                        // or "A5", "Letter", [width, height]
    orientation: "landscape",
    margin: mm(20),
    gap: 10,                                           // space between the children
    header: Text("Annual report"),
    footer: ({ page, pages }) => Text({ align: "center" }, `Page ${page} of ${pages}`),
  },
  ...content,
);
```

Controlling where pages break:

| To | Use |
| --- | --- |
| start a new page | `PageBreak()`, or `break: "before"` on an element |
| keep a block in one piece | `keepTogether: true` |
| keep a heading with what follows | `Heading(...)` does it; elsewhere `keepWithNext: true` |
| avoid stranded lines | `orphans` and `widows` (both default to 2) |

`Heading({ level: 2 }, "Title")` also becomes a bookmark in the PDF, and `TableOfContents()` lists the headings with their page numbers.

## A theme

Define fonts, colours and text styles once, and use them by name.

```ts
import { defineTheme } from "mbingpdf";

const theme = defineTheme({
  fonts: { body: { variable: inter } },                // or { sources: { 400: regular, 700: bold } }
  colors: { text: "#111827", muted: "#6B7280", brand: "#0F62FE" },
  text: {
    body: { font: "body", size: 10, leading: 14, color: "text" },   // the document's default
    h1: { font: "body", weight: 700, size: 22, leading: 28, color: "brand" },
    caption: { font: "body", size: 8, color: "muted" },
  },
});

Document({ theme }, Page(Text({ style: "h1" }, "Invoice"), Text({ style: "caption" }, "INV-0042")));
```

To have the names checked by TypeScript and completed by your editor, register the theme once:

```ts
declare module "mbingpdf" {
  interface Register {
    theme: typeof theme;
  }
}
```

## Preview on screen

`renderSvg` gives one SVG per page from the same layout, for showing a document without a PDF viewer.

```ts
import { renderSvg } from "mbingpdf/svg";
const pages = renderSvg(document);       // string[]
```

In a React or Vue app, the `PdfPreview` component does this for you: pages sized to their container, drawn as they scroll into view, with working links.

```tsx
import { PdfPreview, usePdf } from "@mbingpdf/react";   // or "@mbingpdf/vue"

<PdfPreview document={document} />
```

`usePdf(document)` makes the file itself and gives `{ bytes, url, loading, error, download }`. See the README of [`@mbingpdf/react`](../../packages/react/README.md) or [`@mbingpdf/vue`](../../packages/vue/README.md).

## See it while you write

`@mbingpdf/dev` adds the `mbingpdf` command. Give it a file whose default export is a document, or a function that returns one:

```sh
npm install -D @mbingpdf/dev
npx mbingpdf dev invoice.tsx       # opens a preview that redraws on every save
npx mbingpdf build invoice.tsx     # writes invoice.pdf
```

The preview has a switch that outlines every element's box, lists warnings, and links to the PDF itself. TypeScript and JSX files work as they are.

## For a print shop

```ts
import { cmyk, spot } from "mbingpdf";

Page({ size: "A5", bleed: mm(3), marks: true, fill: cmyk(0.02, 0.02, 0.06, 0) }, ...);

await render(document, {
  conformance: "PDF/X-4",
  outputIntent: { profile: iccProfileBytes, identifier: "FOGRA39" },   // from your print shop
  minImageDpi: 300,                                                    // warn about blurry images
});
```

`size` stays the finished size; the sheet grows to hold the bleed and the marks. PDF/X-4 needs every font embedded, so use a font file rather than the built-in fonts.

## For an archive, and for screen readers

```ts
await render(document, { conformance: "PDF/A-2b" });                 // long-term archiving
await render(document, { conformance: ["PDF/A-2a", "PDF/UA-1"] });   // archived and accessible
await render(document, { tagged: true });                            // just the structure
```

PDF/A fixes what a file may depend on, so that it opens the same in thirty years: every font embedded (use font files, not the built-in fonts) and every colour tied to a profile, sRGB unless you give an `outputIntent`.

A tagged file carries its structure: which text is a heading, what the rows and header cells of a table are, in what order to read. That comes from the elements you already use. What the layout cannot know, you say:

```ts
Document({ title: "Laporan tahunan", lang: "id", font: inter }, ...);   // PDF/UA needs both
Image({ src: photo, width: mm(60), alt: "Bus pariwisata di depan kantor" });
Image({ src: ornament, width: mm(60), decorative: true });              // skipped by screen readers
Stack({ role: "Sect" }, Heading({ level: 2 }, "Ketentuan"), Text("…"));
```

A picture with neither `alt` nor `decorative` is treated as decoration, with a warning. Page headers and footers, backgrounds and borders are marked as decoration automatically.

## Files inside the file

A PDF can carry other files, which a reader lists and can save: the spreadsheet behind a report, the XML of an invoice.

```ts
Document(
  { attachments: [{ name: "data.csv", data: csvText, mimeType: "text/csv", relationship: "Data" }] },
  ...
);
```

For an e-invoice in the Factur-X (ZUGFeRD 2) form, `facturX()` gives the attachment and the metadata that go with it. The XML itself is yours to produce.

```ts
import { facturX } from "mbingpdf";

const document = Document({ title: "Invoice 42", font: inter, ...facturX({ xml, profile: "EN 16931" }) }, ...);
await render(document, { conformance: "PDF/A-3b" });   // PDF/A-3 is the archival level that allows attachments
```

## A password

```ts
await render(document, {
  encryption: {
    userPassword: "rahasia",                        // needed to open the file
    permissions: { print: "low", copy: false },     // what is allowed once it is open
  },
});
```

The file is encrypted with AES-256, which every current viewer reads. `ownerPassword` is a second password that opens the file with the restrictions lifted; leave it out and nobody can lift them. Without a `userPassword` the file opens for anyone and only the restrictions apply.

The password is what protects the content. Permissions are a request that viewers honour, not a lock: someone who can open the file can, with other software, do what they like with it. Archival and print files (PDF/A, PDF/X) cannot be encrypted.

## JSX

The same documents can be written as JSX; no React is involved. Set `"jsx": "react-jsx"` and `"jsxImportSource": "mbingpdf"` in `tsconfig.json`.

```tsx
<Document title="Invoice">
  <Page size="A4" margin={mm(20)}>
    <Text size={22}>Invoice</Text>
    <Table columns={columns} header={header} rows={rows} />
  </Page>
</Document>
```

## When something looks wrong

```ts
await render(document, {
  debug: true,                               // outline every element's box
  strict: true,                              // turn warnings into errors
  onWarning: (warning) => console.warn(warning.message, warning.path),
});

import { inspect } from "mbingpdf";
inspect(document);                           // every box of every page, as plain data, for tests
```

Warnings tell you about characters no font could show and images that would print blurred, with the path of the element concerned.

## Next

- [Element reference](./elements.md) — every element and its properties.
- [Moving a printed page to mbingpdf](./adopting.md) — for an app that prints HTML today.
- [`examples/`](../../examples) — starter templates: invoice, report, letter, certificate, label sheet.
