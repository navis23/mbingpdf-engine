# mbingpdf

A TypeScript library for generating production-grade PDF documents in any JavaScript runtime: browsers, Node, Bun, Deno and edge functions.

**Status: early development.** The API may still change before 1.0.

```ts
import { Document, Page, Row, Stack, Text, Image, render, mm } from "mbingpdf";

const pdf = await render(
  Document(
    { title: "Invoice INV-0042" },
    Page(
      { size: "A4", margin: mm(20), footer: ({ page, pages }) => Text({ align: "center" }, `Page ${page} of ${pages}`) },
      Row({ justify: "space-between" }, Image({ src: logo, width: mm(40) }), Text({ size: 22 }, "Invoice")),
      Stack({ gap: 4 }, Text("Yayasan Contoh"), Text("Jl. Merdeka No. 17, Bandung")),
    ),
  ),
); // Uint8Array
```

What works today:

- **Documents** (`mbingpdf`) — rows and stacks with flexbox-style sizing, tables with repeated headers, lists, multi-column sections, grids, text with mixed styles and links, images, SVG artwork and QR codes as vectors, absolute positioning and free drawing. Content flows over pages with forced breaks, keep-together, keep-with-next and widow/orphan control; headers and footers know the page number and total; headings become bookmarks and a table of contents.
- **Barcodes and charts** — Code 128, EAN-13, EAN-8, UPC-A, Code 39 and ITF as vectors; bar, line and pie charts; text on a `Canvas`.
- **Standards** — PDF/A-2 and PDF/A-3 for archiving, and tagged PDF with PDF/UA-1 for accessibility, checked with veraPDF.
- **Protection** — password encryption with AES-256 and permissions; files attached inside the PDF, including Factur-X e-invoices.
- **Themes** — fonts with weights, colours and text styles defined once with `defineTheme` and used by name.
- **Print** — CMYK and spot colours, bleed, crop and registration marks, ICC output intent, PDF/X-4.
- **Text** (`mbingpdf/text`) — Unicode line breaking, hyphenation for English and Indonesian, justification, font fallback and fit-to-width.
- **Fonts** (`mbingpdf/font`) — TrueType, OpenType/CFF and (on servers) WOFF2: subsetting, variable-font instancing, and shaping (ligatures, kerning, accents) that matches HarfBuzz for Latin, Greek and Cyrillic.
- **Preview** (`mbingpdf/svg`) — the same pages as SVG, for showing a document on screen. [`@mbingpdf/react`](https://github.com/navis23/mbingpdf-engine/tree/main/packages/react) and [`@mbingpdf/vue`](https://github.com/navis23/mbingpdf-engine/tree/main/packages/vue) wrap it in a `PdfPreview` component.
- **Images** (`mbingpdf/image`) — JPEG and PNG, embedded without re-encoding where possible.
- **The PDF writer** (`mbingpdf/core`) — pages, vector graphics, RGB and CMYK colour, opacity, print boxes, the 14 standard fonts.

[`@mbingpdf/dev`](https://github.com/navis23/mbingpdf-engine/tree/main/packages/dev) adds a preview server that redraws a document on every save.

## Install

```sh
npm install mbingpdf
```

Node 22 or later, current browsers, Bun, Deno and edge runtimes. There are no runtime dependencies.

## Documentation

**[mbingpdf.enterbiner.com](https://mbingpdf.enterbiner.com)**: the guides below, and a playground that runs the library in your browser.

- [Quick start](https://github.com/navis23/mbingpdf-engine/blob/main/docs/guide/quick-start.md)
- [Element reference](https://github.com/navis23/mbingpdf-engine/blob/main/docs/guide/elements.md)
- [Starter templates](https://github.com/navis23/mbingpdf-engine/tree/main/examples): invoice, report, letter, certificate, label sheet

## Entry points

| Import | What it is |
| --- | --- |
| `mbingpdf` | The document API: elements, `render`, themes, fonts, units, colours |
| `mbingpdf/svg` | `renderSvg`: the same pages as SVG, for on-screen preview |
| `mbingpdf/jsx-runtime` | Lets documents be written in JSX (`jsxImportSource: "mbingpdf"`) |
| `mbingpdf/core` | The PDF writer on its own: pages, drawing, fonts, images |
| `mbingpdf/font` | Font parsing, subsetting, shaping, variable-font instancing |
| `mbingpdf/text` | Line breaking, hyphenation, paragraph layout |
| `mbingpdf/image` | JPEG and PNG decoding |
| `mbingpdf/qr` | QR code generation |
| `mbingpdf/barcode` | One-dimensional barcode patterns |

## Licence

MIT. Bundled data carries its own notices: the Adobe Core 14 font metrics, Unicode Character Database tables, and the TeX hyphenation patterns for American English (see the generated source files).
