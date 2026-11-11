---
"mbingpdf": minor
"@mbingpdf/react": minor
"@mbingpdf/vue": minor
"@mbingpdf/dev": minor
---

First release.

- Document API: `Document`, `Page`, `Stack`, `Row`, `Box`, `Text`, `Span`, `Link`, `Heading`, `List`, `Table`, `Columns`, `Grid`, `Image`, `Svg`, `QrCode`, `Canvas`, `Absolute`, `Spacer`, `PageBreak`, `TableOfContents`, rendered with `render()`.
- Pagination: forced breaks, keep-together, keep-with-next, widows and orphans, repeated table headers, headers and footers with page number and total.
- Fonts: TrueType, OpenType/CFF and WOFF2 with subsetting, shaping (ligatures, kerning, accents), variable-font instancing and fallback; the 14 standard fonts.
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
