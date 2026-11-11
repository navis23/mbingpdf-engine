# Moving a printed page to mbingpdf

This is for an app that makes its documents today by styling an HTML page for print and calling `window.print()`. It takes one document from that to a real PDF file. Do one document first, end to end, before touching the others.

Read the [quick start](./quick-start.md) for the API; the [element reference](./elements.md) lists every property. This page is about fitting it into an existing app.

## 1. Install

```sh
npm install mbingpdf                    # the library; no dependencies
npm install @mbingpdf/react             # or @mbingpdf/vue: the on-screen preview
```

To try a build that is not on npm yet, install the packed files instead. Install all of them in one command, so the preview package finds the library it depends on:

```sh
pnpm add /path/to/mbingpdf-0.0.0.tgz /path/to/mbingpdf-react-0.0.0.tgz
```

Needs Node 22 or later on a server; any current browser.

## 2. Write the document as a function of its data

Keep it out of the component that shows it: one file, one function, plain data in, a `Document` out. No hooks, no fetching, no reading of global state. That makes it usable in the browser, on the server and in a test.

```ts
// documents/invoice.ts
import { Document, Page, Row, Stack, Table, Text, type Font, mm } from "mbingpdf";

export interface InvoiceData {
  number: string;
  customer: string;
  lines: { name: string; quantity: number; price: number }[];
}

export function invoiceDocument(data: InvoiceData, assets: { font: Font; logo: Uint8Array }) {
  return Document(
    { title: `Invoice ${data.number}`, lang: "id", font: assets.font, size: 10 },
    Page({ size: "A4", margin: mm(20), gap: 16 }, /* … */),
  );
}
```

How the pieces of a print stylesheet translate:

| In the HTML page | In mbingpdf |
| --- | --- |
| `display: flex` in a row | `Row({ gap, align, justify })`; children take `grow`, `shrink`, `basis` |
| blocks one under another | `Stack({ gap })`, or just the children of `Page` |
| `padding`, `border`, `background`, `border-radius` | the same names on any element (`radius` for the corners) |
| `<table>` with `thead` repeated on each page | `Table({ columns, header, rows, footer })` |
| `<img>` | `Image({ src: bytes })`; an SVG logo is `Svg({ src: markup })` |
| `@page { size: A4; margin: 20mm }` | `Page({ size: "A4", margin: mm(20) })` |
| `break-before: page`, `break-inside: avoid` | `break: "before"`, `keepTogether: true` |
| a fixed header or footer, page numbers | `Page({ header, footer: ({ page, pages }) => … })` |
| `position: absolute` | `Absolute({ top, left, … })` |
| text shrunk by script to fit a box | `Text({ fit: true })` |
| a QR code or barcode drawn by another library | `QrCode({ value })`, `Barcode({ value })` |
| sizes in `mm` or `px` | points; `mm(20)` converts. A CSS pixel is 0.75 pt |

Text properties (`font`, `size`, `color`, `lineHeight`, `align`) set on any element apply to everything inside it, as in CSS.

## 3. Fonts and images

The PDF embeds the font files themselves, so the app must hand over their bytes: a web font loaded by CSS is not enough. Load each file once and keep the result.

```ts
import { loadFont, type Font } from "mbingpdf";

let cached: Promise<Font> | undefined;
export function brandFont(): Promise<Font> {
  cached ??= fetch("/fonts/Inter-Variable.woff2")          // .ttf, .otf and .woff2 all work
    .then((response) => response.arrayBuffer())
    .then((buffer) => loadFont(new Uint8Array(buffer)));
  return cached;
}
```

With a bundler, import the file's address instead of hard-coding it (`import url from "./Inter.woff2?url"` in Vite). A variable font gives every weight from one file: `font.instance({ wght: 700 })`.

Images are bytes too: `new Uint8Array(await (await fetch(url)).arrayBuffer())`. JPEG and PNG are supported. Images from another origin need that origin to allow the request (CORS).

Without a font, text is set in Helvetica, which covers English and Indonesian and adds nothing to the file. That is fine for a first version.

## 4. Show it and save it

```tsx
import { PdfPreview, usePdf } from "@mbingpdf/react";      // the Vue package has the same names

const document = useMemo(() => invoiceDocument(data, assets), [data, assets]);
const pdf = usePdf(document);

<PdfPreview document={document} />
<button disabled={pdf.loading} onClick={() => pdf.download(`invoice-${data.number}.pdf`)}>Download</button>
```

The preview is the PDF's own layout, so what is on screen is what is in the file. To print, open the file and let the browser's viewer print it: `window.open(pdf.url)`.

Where the old print button was, keep it until the new document has been compared with the old one (step 6), then remove the print stylesheet for that document.

In a server-rendered app (Next, Nuxt) the preview draws in the browser only; wrap it so it is not rendered on the server (`<ClientOnly>` in Nuxt).

## 5. On a server, if you need the file there

The same function works in an API route, for attaching to an e-mail or storing:

```ts
import { render } from "mbingpdf";

const bytes = await render(invoiceDocument(data, assets));   // Uint8Array
return new Response(bytes, { headers: { "Content-Type": "application/pdf" } });
```

Read fonts and images from disk or storage there instead of fetching them by address.

## 6. Check it

- Put the new PDF beside the old printed page. Check every field with real data: the longest name, an empty optional field, a list long enough to need a second page.
- Render with `strict: true` in a test. It turns warnings into errors: a character the font lacks, an image too small for print.
- `inspect(document)` returns every box on every page as plain data, for tests such as "the total is on the last page".
- Many documents at once (a sheet of labels, a batch of certificates) belong in one `Document` with many pages, not many files. If making it freezes the page, do it in a Web Worker: the library has no dependency on the DOM.

## 7. Write down what was awkward

This is the point of doing one document first. Note anything that needed a workaround, anything the old page did that could not be reproduced, and any name or default that was surprising, and send it to the library's maintainers before moving the next document.
