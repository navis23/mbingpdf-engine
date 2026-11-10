# 04 — API design

All code here is a proposal. Names will change as we build; the shape is what we are agreeing on.

## Three levels, one engine

| Level | Use it when | Entry point |
| --- | --- | --- |
| Document | You have data and want a laid-out document | `mbingpdf` |
| Canvas | You need exact drawing inside a region of a document | `Canvas` element |
| Core | You are building a tool and want raw PDF objects | `mbingpdf/core` |

Levels mix freely: a `Canvas` element sits inside a flowing document and receives its laid-out size.

## Document level

Elements are plain functions that return plain data. No classes, no hidden state, no framework.

```ts
import { Document, Page, Row, Stack, Text, Image, Table, render, mm } from "mbingpdf";

const invoice = Document({
  title: "Invoice INV-0042",
  lang: "en",
  theme,
  children: [
    Page({
      size: "A4",
      margin: mm(20),
      footer: ({ page, pages }) =>
        Text({ style: "caption", align: "center" }, `Page ${page} of ${pages}`),
      children: [
        Row({ justify: "space-between", align: "start" }, [
          Image({ src: logo, width: mm(40) }),
          Stack({ align: "end", gap: 2 }, [
            Text({ style: "h1" }, "Invoice"),
            Text({ color: "muted" }, "INV-0042"),
          ]),
        ]),
        Table({
          columns: [{ width: "1fr" }, { width: 60, align: "end" }, { width: 80, align: "end" }],
          header: ["Description", "Qty", "Amount"],
          rows: items.map((i) => [i.name, i.qty, money(i.total)]),
          repeatHeader: true,
        }),
        Stack({ keepTogether: true, align: "end" }, [
          Text({ style: "total" }, `Total ${money(total)}`),
        ]),
      ],
    }),
  ],
});

const bytes = await render(invoice);            // Uint8Array
const stream = render.stream(invoice);          // ReadableStream<Uint8Array>
```

### The same document in JSX

An optional JSX runtime produces the same data. It needs no React.

```tsx
/** @jsxImportSource mbingpdf */
<Document title="Invoice INV-0042" theme={theme}>
  <Page size="A4" margin={mm(20)}>
    <Text style="h1">Invoice</Text>
    <Table columns={columns} header={header} rows={rows} repeatHeader />
  </Page>
</Document>
```

### Element set for v1

| Group | Elements |
| --- | --- |
| Structure | `Document`, `Section`, `Page`, `PageBreak` |
| Layout | `Stack`, `Row`, `Box`, `Grid`, `Columns`, `Spacer`, `Absolute` |
| Text | `Text`, `Heading`, `Paragraph`, `Span`, `Link`, `List` |
| Data | `Table` |
| Media | `Image`, `Svg`, `QrCode`, `Canvas` |
| Navigation | `Bookmark`, `TableOfContents` |

## Design system

Easy to design means a brand is defined once and referenced by name.

```ts
import { defineTheme } from "mbingpdf";

const theme = defineTheme({
  fonts: {
    body: { family: "Inter", sources: { 400: interRegular, 600: interSemiBold } },
    mono: { family: "JetBrains Mono", sources: { 400: jbMono } },
  },
  colors: { text: "#111827", muted: "#6B7280", brand: "#0F62FE" },
  space: [0, 2, 4, 8, 12, 16, 24, 32],
  text: {
    body: { font: "body", size: 10, leading: 14 },
    h1: { font: "body", weight: 600, size: 22, leading: 28 },
    caption: { font: "body", size: 8, color: "muted" },
  },
});
```

`defineTheme` returns a typed theme. `style: "h1"` autocompletes and `style: "h7"` is a compile error. Token names, colour names and font names are all checked this way.

## Units and colour

```ts
mm(20); cm(2); inch(1); pt(12);      // explicit units; bare numbers are points
rgb(15, 98, 254); "#0F62FE";
cmyk(0.9, 0.6, 0, 0);
spot("PANTONE 286 C", cmyk(1, 0.75, 0, 0.02));
```

## Canvas level

For charts, diagrams and anything the layout elements do not cover.

```ts
Canvas({ width: "100%", height: 120 }, (g, { width, height }) => {
  g.rect(0, 0, width, height).stroke({ color: "muted", width: 0.5 });
  g.path().moveTo(0, height).lineTo(width, 0).stroke({ color: "brand", width: 1.5 });
  g.text("Revenue", 4, 12, { style: "caption" });
});
```

## Core level

```ts
import { PdfWriter } from "mbingpdf/core";

const pdf = new PdfWriter();
const page = pdf.addPage({ width: 595.276, height: 841.89 });
page.content.moveTo(72, 72).lineTo(200, 72).stroke();
const bytes = await pdf.finish();
```

## Render options

```ts
await render(doc, {
  conformance: "PDF/A-2b",        // or "PDF/UA-1"; violations throw with the element path
  deterministic: true,            // fixed dates and IDs: same input, same bytes
  strict: true,                   // layout warnings become errors
  encryption: { userPassword, ownerPassword, permissions: { print: true, copy: false } },
  onWarning: (w) => log(w),
});
```

## Print output

```ts
Page({
  size: "A4",
  orientation: "landscape",
  bleed: mm(3),                    // content may extend 3 mm past the trim edge
  marks: { crop: true, registration: true },
});

await render(certificate, {
  conformance: "PDF/X-4",
  outputIntent: fogra39,           // ICC profile bytes named by the print shop
  minImageDpi: 300,                // warn below this effective resolution
});
```

## Fit text, grids and QR codes

```ts
Text({ style: "display", fit: { min: 24, max: 96 } }, runner.name);   // one line, sized to the box

Grid({ columns: 3, rows: 8, cell: { width: mm(70), height: mm(37) } },
  runners.map((r) => Label(r)));                                       // flows onto new sheets

QrCode({ value: `BIB:${r.bib}`, size: mm(22), level: "M" });           // vector, not an image
```

## Preview and workers

```ts
import { renderSvg } from "mbingpdf/svg";
const pages = await renderSvg(doc);              // string[] — one SVG per page, same layout as the PDF

import { createRenderer } from "mbingpdf/worker";
const renderer = createRenderer();               // runs layout off the main thread
const bytes = await renderer.render(doc);
```

Framework packages wrap this: `<PdfPreview :document="doc" />` in Vue, `<PdfPreview document={doc} />` in React.

A document definition is plain data, so it crosses the worker boundary and can be built in the browser and rendered on the server.

## Error and warning behaviour

- **Compile time:** unknown properties, wrong units, invalid nesting, missing theme tokens.
- **Render time, always thrown:** unreadable font or image, conformance violation, content that can never fit a page.
- **Render time, warning by default:** missing glyph (after fallback), overflowing text, an image upscaled past a DPI threshold. `strict: true` turns these into errors.
- Every message carries the element path, for example `Document > Page[0] > Table > row[14] > cell[2]`.

## Developer tooling

- `mbingpdf dev invoice.tsx` — local preview that re-renders on save.
- Debug overlay: outlines every box with its margin and padding, like browser devtools.
- `inspect(doc)` — returns the laid-out tree as JSON for tests and bug reports.
- Starter templates: invoice, report, letter, certificate, label sheet.
