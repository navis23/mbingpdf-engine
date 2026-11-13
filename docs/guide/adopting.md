# Moving a printed page to mbingpdf

This is for an app that makes its documents today by styling an HTML page for print and calling `window.print()`. It takes one document from that to a real PDF file. Do one document first, end to end, before touching the others.

Read the [quick start](./quick-start.md) for the API; the [element reference](./elements.md) lists every property. This page is about fitting it into an existing app.

## 1. Install

```sh
npm install mbingpdf                    # the library; no dependencies
npm install @mbingpdf/react             # or @mbingpdf/vue: the on-screen preview
```

To try a build that is not on npm (a fix that is not released yet), install packed files instead: `pnpm pack` in each package of the library's repository makes them. Copy them into the app's repository first (a `vendor/` folder): a path outside the repository ends up in the lockfile, where CI and teammates cannot follow it. Install all of them in one command, so the preview package finds the library it depends on:

```sh
pnpm add ./vendor/mbingpdf-0.1.0.tgz ./vendor/mbingpdf-react-0.1.0.tgz
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
| `text-overflow: ellipsis` on one line | `Text({ truncate: true })` |
| centring a block down the page, or a footer pushed to the bottom | `Page({ justify: "center" })`; `Stack({ height, justify })`; a `Spacer()` between the blocks |
| `border-style: dashed` | `border: { width, color, dash: [3, 2] }` |
| a background image with `object-fit: cover` | `Image` or `Svg` with `width`, `height` and `fit: "cover"` |
| an SVG recoloured with `currentColor` or a CSS filter | `Svg({ color })`; `monochrome: true` if the file has fixed colours |
| a QR code or barcode drawn by another library | `QrCode({ value })`, `Barcode({ value })` |
| sizes in `mm` or `px` | points; `mm(20)` converts. A CSS pixel is 0.75 pt |

Text properties (`font`, `size`, `color`, `lineHeight`, `align`) set on any element apply to everything inside it, as in CSS.

Two things differ from CSS. A child of a `Row` is as wide as its content unless it has a `width` or `grow`, and it will not shrink below its longest word, so give a long text in a row `grow: 1, basis: 0`, or `truncate` or `fit`. And there is no `min-width: 0` to remember: text with `truncate` or `fit` gives way by itself.

## 3. Fonts and images

The PDF embeds the font files themselves, so the app must hand over their bytes: a web font loaded by CSS is not enough. Load each file once and keep the result.

Use the `.ttf` or `.otf` file. WOFF2, the format web fonts are served in, can be read on a server but not in a browser. If WOFF2 is all you have, unpack it once on Node: `decodeWoff2(bytes, zlib.brotliDecompressSync)` from `mbingpdf/font` gives the TTF.

```ts
import { loadFont, type Font } from "mbingpdf";

let cached: Promise<Font> | undefined;
export function brandFont(): Promise<Font> {
  cached ??= fetch("/fonts/Inter-Variable.ttf")            // .ttf or .otf
    .then((response) => response.arrayBuffer())
    .then((buffer) => loadFont(new Uint8Array(buffer)));
  return cached;
}
```

With a bundler, import the file's address instead of hard-coding it (`import url from "./Inter.ttf?url"` in Vite). A variable font gives every weight from one file: `font.instance({ wght: 700 })`.

Images are bytes too: `new Uint8Array(await (await fetch(url)).arrayBuffer())`. JPEG and PNG are read directly. Uploads are often WebP: `await loadImage(bytes)` reads those with the library's own decoder, in the browser and on a server alike, and gives something `Image` accepts. It gives the same pixels on both sides, so a document made on the server matches the one made in the browser. Use `loadImage` for every upload; it also passes JPEG and PNG through. AVIF and GIF are read only in a browser, by its own decoder; on a server, convert them to PNG or JPEG first. Images from another origin need that origin to allow the request (CORS).

An upload usually has far more pixels than its place on the page needs, and a decoded image is stored without loss, so a large logo drawn small can add hundreds of kilobytes. `render(document, { maxImageDpi: 300 })` (150 is enough for the screen) stores such images at the size they are drawn; a page with a 1600 × 900 picture drawn 40 points high goes from 334 kB to 49 kB, and looks the same. JPEG files are embedded as they are: size photos when they are uploaded (1,000 to 1,500 pixels on the long side is plenty for a page), and keep drawings and logos as PNG or WebP.

In Nuxt, `@nuxt/fonts` serves CSS web fonts, not bytes, and server assets are kept from the browser. What works: put the TTF files in `server/assets/fonts`, read them on the server with `useStorage("assets:server")`, and add a server route that serves an allow-listed file with a long cache for the browser to fetch. List `mbingpdf`, `mbingpdf/svg` and `@mbingpdf/vue` in `vite.optimizeDeps.include`, or the dev server finds them on the first page that uses them and reloads it.

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

`usePdf` makes the file again whenever the document changes. For a big document behind filters (a sheet of hundreds of labels) that is waste: pass `{ lazy: true }`, and the file is made when `pdf.download(name)` or `pdf.make()` is called.

Give the preview a `pageLabel` in the app's language, `(page, pages) => \`Halaman ${page} dari ${pages}\``; screen readers are given that and the page's text.

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
- `inspect(document)` returns an array with one `{ page, boxes }` per page, every box as plain data with its position, size, text and children, for tests such as "the total is on the last page".
- Many documents at once (a sheet of labels, a batch of certificates) belong in one `Document` with many pages, not many files. If making it freezes the page, do it in a Web Worker: the library has no dependency on the DOM.

## 7. Write down what was awkward

This is the point of doing one document first. Note anything that needed a workaround, anything the old page did that could not be reproduced, and any name or default that was surprising, and send it to the library's maintainers before moving the next document.
