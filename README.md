# mbingpdf

A TypeScript library for generating production-grade PDF documents in any JavaScript runtime: browsers, Node, Bun, Deno and edge functions.

**Status: early development.** Nothing is published to npm yet, and the API may still change.

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
- **Themes** — fonts with weights, colours and text styles defined once with `defineTheme` and used by name.
- **Print** — CMYK and spot colours, bleed, crop and registration marks, ICC output intent, PDF/X-4.
- **Text** (`mbingpdf/text`) — Unicode line breaking, hyphenation for English and Indonesian, justification, font fallback and fit-to-width.
- **Fonts** (`mbingpdf/font`) — TrueType, OpenType/CFF and WOFF2: subsetting, variable-font instancing, and shaping (ligatures, kerning, accents) that matches HarfBuzz for Latin, Greek and Cyrillic.
- **Preview** (`mbingpdf/svg`) — the same pages as SVG, for showing a document on screen.
- **Images** (`mbingpdf/image`) — JPEG and PNG, embedded without re-encoding where possible.
- **The PDF writer** (`mbingpdf/core`) — pages, vector graphics, RGB and CMYK colour, opacity, print boxes, the 14 standard fonts.

Documentation, starter templates, a preview server and the first npm release come next. The design is in [`docs/`](./docs/README.md).

## Development

```sh
pnpm install
pnpm check          # lint, typecheck, test, build
pnpm test:update    # approve changed output (golden images and digests) after reviewing it
pnpm test:runtime   # built package gives byte-identical output on Node, Deno and Chromium
```

The tests use `qpdf` for structural checks when it is installed, and render every sample with pdf.js and PDFium to compare against approved images in `packages/mbingpdf/test/golden/`.

## Goals

- Describe a document; the engine handles layout, page breaks, headers and footers.
- Text measured from the font itself, so output is identical on every runtime.
- Print-ready: CMYK, bleed, trim marks, PDF/X-4.
- Typed themes: brand fonts, colours and styles defined once.
- Framework-neutral, with optional React and Vue preview components.

## Licence

MIT
