# mbingpdf

## 0.2.2

### Patch Changes

- 0264f07: Fixes from the second app to adopt the library:
  
  - A page's content starts below that page's own header and stops above its own footer, so a header that is absent on the first page and a running head on the rest no longer overprints the text.
  - A heading is not left alone at the foot of a page when it is the first thing in its box and the paragraph after it moves on.
  - `height: "100%"` inside an `Absolute` no longer throws ("Cannot write Infinity to a PDF"): a percentage there is a share of the box the `Absolute` fills, and an `Absolute` given both `top` and `bottom` is as tall as the space between them.
  - Letter-spaced text is copied as whole words (`TANGGAL`, not `TA N G GA L`) by poppler-based readers: the spacing is written as character spacing, with the text as `ActualText`. It looks exactly the same.
  - A theme made in a function can be registered (`theme: ReturnType<typeof makeTheme>`) without a circular type.
  - `leading` (line height in points) is accepted on every element, not only in theme text styles.
  - `inspect()` reports the page background too, before the header.

## 0.2.1

### Patch Changes

- a0236d1: `render(document, { maxImageDpi: 300 })` stores an image that has far more pixels than its place on the page needs at that resolution instead, so a large upload drawn as a small logo adds a few kilobytes, not hundreds. It applies to PNG and WebP images (and anything else `loadImage` decodes); JPEG files are embedded as they are. `shrinkImage(image, width, height)` in `mbingpdf/image` does the same by hand.

## 0.2.0

### Minor Changes

- 4b1c252: WebP images are read by the library itself, on servers as well as in browsers: `await loadImage(bytes)` now decodes lossy, lossless and transparent WebP files everywhere, and `decodeWebp` from the new `mbingpdf/webp` entry does it synchronously. The pixels are exactly the ones libwebp produces, on Node, Deno, Bun and in browsers. The decoder (about 18 kB gzip) loads only when a WebP file is read. Animated WebP files are refused.

### Patch Changes

- 0996cba: A hyphen that hyphenation adds at a line break now reads as a soft hyphen (U+00AD) in files with embedded fonts, as tagged PDF requires: screen readers and copied text get the word whole, while the hyphen is drawn as before. Real hyphens are unchanged.
- 9cc1340: The packages' home page is now the website, https://mbingpdf.enterbiner.com, with a playground and the documentation.

## 0.1.0

### Minor Changes

- aa20853: First release.
  
  - Document API: `Document`, `Page`, `Stack`, `Row`, `Box`, `Text`, `Span`, `Link`, `Heading`, `List`, `Table`, `Columns`, `Grid`, `Image`, `Svg`, `QrCode`, `Canvas`, `Absolute`, `Spacer`, `PageBreak`, `TableOfContents`, rendered with `render()`.
  - Pagination: forced breaks, keep-together, keep-with-next, widows and orphans, repeated table headers, headers and footers with page number and total.
  - Fonts: TrueType, OpenType/CFF and (on servers) WOFF2 with subsetting, shaping (ligatures, kerning, accents), variable-font instancing and fallback; the 14 standard fonts.
  - Text: Unicode line breaking, hyphenation for English and Indonesian, justification, fit-to-width.
  - Themes with `defineTheme`; JSX through `mbingpdf/jsx-runtime`.
  - SVG artwork used many times (a logo on every page) is stored once in the file.
  - Print: CMYK and spot colours, bleed, crop and registration marks, ICC output intent, PDF/X-4.
  - `Barcode` (Code 128, EAN-13, EAN-8, UPC-A, Code 39, ITF), `BarChart`, `LineChart`, `PieChart`, and text on a `Canvas`; `mbingpdf/barcode` for barcode patterns alone.
  - Layout: `justify` on `Stack` and `Page`, a `Spacer()` that takes spare height, `Text({ truncate })`, dashed borders, `Svg({ fit: "cover", monochrome })`, `width: "auto"`.
  - `loadImage()` reads WebP, AVIF and GIF in a browser.
  - Standards: PDF/A-2 and PDF/A-3 (levels b, u, a) and PDF/UA-1 through `conformance`; tagged PDF with `tagged: true`, with `alt`, `decorative` and `role` on elements.
  - Attached files with `Document({ attachments })`, and `facturX()` for Factur-X e-invoices.
  - Password protection with AES-256 and permissions through `encryption`.
  - SVG preview with `renderSvg` and `previewPages` from `mbingpdf/svg`.
  - `@mbingpdf/react` and `@mbingpdf/vue`: a `PdfPreview` component and `usePdf` for each framework.
  - Lower layers on their own: `mbingpdf/core`, `mbingpdf/font`, `mbingpdf/text`, `mbingpdf/image`, `mbingpdf/qr`, `mbingpdf/barcode`.
  - `@mbingpdf/dev`: the `mbingpdf` command. `mbingpdf dev file.tsx` shows a document in the browser and redraws it on every save; `mbingpdf build file.tsx` writes the PDF.
