# 05 — Roadmap

Milestones are ordered by dependency. Each ends with something a user can run and an exit test that either passes or does not. No dates are attached until M0 and M1 show our real pace.

## M0 — Foundations

_Status: done 2026-11-10. Exit test passes in CI on Node 22/24/26, Bun, Deno and Chromium. Left out on purpose: kerning for the standard fonts, XMP metadata, streaming output, printer's marks_

Repository, toolchain and a valid PDF.

- pnpm workspace, TypeScript strict, tsdown, Vitest, Biome, Changesets, CI on Node, Bun, Deno and a headless browser.
- PDF object model and serialiser, xref streams, deflate, document metadata.
- Pages, vector paths, fills, strokes, transforms, clipping, opacity.
- RGB and CMYK colour; MediaBox, TrimBox and BleedBox.
- Text with the 14 standard fonts.
- Test harness: qpdf structural check and render-to-PNG comparison (see [06-quality.md](./06-quality.md)).

**Exit:** a script draws shapes and standard-font text on several pages; the file passes `qpdf --check` and renders identically in pdf.js and PDFium on all four runtimes.

## M1 — Fonts and text

_Status: done 2026-11-10, except the manual half of the exit test (copying text out of Acrobat; pdf.js extraction is tested instead). Everything listed below is built and tested: glyph mapping, shaping, instancing and subset size are checked against HarfBuzz, line breaking and grapheme clusters against the Unicode conformance files. Known limits: CFF subsets keep all subroutines, CFF2 and font collections are rejected, instances of variable fonts are unhinted, line filling is greedy_

- TrueType and OpenType/CFF parsing, WOFF2 decoding, variable-font instancing.
- Glyph subsetting, CID font embedding, `ToUnicode` maps.
- Simple-script shaping: kerning, ligatures, mark positioning, OpenType feature toggles.
- Line breaking (UAX #14), grapheme segmentation, alignment, justification, letter and word spacing, case transforms.
- Fit-to-width text.
- Hyphenation for English and Indonesian.
- Font fallback chains. The `Shaper` interface.

**Exit:** a paragraph in a custom font with mixed weights wraps, justifies, and copies out of Acrobat as correct Unicode. Embedded font size is within 10% of the subset HarfBuzz's tooling produces for the same glyphs.

## M2 — Layout and pagination

_Status: done 2026-11-10. The exit test passes: a 53-page report with headings, paragraphs, images and "Page X of Y" renders from the document API in about 0.4 s, and the invoice from the API design runs without its table. The SVG backend (`mbingpdf/svg`) and a Web Worker run are tested. Not done by design: row wrapping; `render.stream()` produces its chunks after layout rather than page by page; a `createRenderer()` worker wrapper (the library itself runs in a worker)_

- Document tree, style resolution and inheritance.
- Box model, `Stack`, `Row` with flex semantics, `Box`, `Grid`, `Spacer`, `Absolute` with rotation.
- Inline layout with mixed spans and links.
- JPEG and PNG images.
- Fragmentation across pages: forced breaks, `keepTogether`, `keepWithNext`, widows and orphans.
- Page headers and footers, page number and total pages.
- `render()` returning bytes and a stream; rendering inside a Web Worker.
- SVG backend for on-screen preview.

**Exit:** a 50-page report with headings, paragraphs, images and a footer showing "Page X of Y" renders from the document API with no manual coordinates. The invoice example in the API doc runs minus the table.

## M3 — Tables, vector art and print

_Status: done 2026-11-10, with one item moved and two manual checks open. All three exit tests pass: a 1,000-row table with repeated headers; the invoice and finisher-certificate acceptance documents as samples (the certificate with bleed, marks, a spot colour and PDF/X-4); and 5,000 bibs in one file in about 10 s. Built: tables, lists, multi-column sections, headings with bookmarks, links within the document, table of contents, SVG input, QR codes, `fit` text, themes, and print output. Moved to M4: sharing repeated graphics between pages (Form XObjects) — fonts and images are already shared, and batches are fast and small without it. Open manual checks: an Acrobat PDF/X-4 preflight of the certificate, and comparing the two acceptance documents with their current printed versions. Not supported: table row spans; SVG gradients, text, clipping and masks_

- Tables: column sizing, spans, borders, zebra rows, repeated headers and footers, split and non-split rows, group subtotals.
- Lists, multi-column sections, per-section page size and orientation.
- Outlines (bookmarks), internal links, generated table of contents.
- SVG to vector; vector QR codes.
- Themes and `defineTheme` typing.
- Print: bleed, crop and registration marks, spot colours, ICC output intent, PDF/X-4, image DPI warnings.
- Repeated graphics embedded once and reused across pages.

**Exit:**
- A 1,000-row table renders across pages with repeated headers inside a stated time and memory budget (targets set from M2 measurements).
- The invoice and finisher-certificate acceptance documents from [08-target-documents.md](./08-target-documents.md) match their current printed versions; the certificate passes a PDF/X-4 preflight.
- 5,000 bibs render into one file inside the same budget.

## M4 — Developer experience and first public release

_Status: done 2026-11-11, with the manual checks open. Version 0.1.0 is on npm with `@mbingpdf/react`, `@mbingpdf/vue` and `@mbingpdf/dev`; the running-event app has moved its documents to it (the rental app has not yet); the website with a playground is live at mbingpdf.enterbiner.com. Open: the Acrobat checks by hand, and one document in the rental app._

- JSX runtime.
- `@mbingpdf/react` and `@mbingpdf/vue` preview components.
- Preview server with hot reload and debug overlay.
- Warnings with element paths, strict mode, `inspect()`.
- Documentation site with runnable examples; starter templates.
- Bundle-size budget enforced in CI.
- Benchmarks published against PDFKit, pdfmake and @react-pdf/renderer.

**Exit:** `0.1.0` on npm. The rental agreement with inspection report (third acceptance document) is rebuilt and one document type in each of our two apps is switched from browser print to mbingpdf. A developer who has never seen the library produces a branded invoice from the quick-start in under fifteen minutes.

## M5 — Archival and accessibility standards

_Status: done except the manual check. PDF/A-2b, 2u, 2a and PDF/A-3b, 3u, 3a; tagged PDF from element semantics; PDF/UA-1; attached files and Factur-X metadata; AES-256 encryption and permissions; veraPDF over the sample suite in the tests and in CI. Open: Acrobat's accessibility checker, by hand, which needs the owner._

- Tagged PDF generated from element semantics; alt text, language, reading order, table header associations.
- PDF/UA-1 and PDF/A-2b, A-2u, A-3b (A-3 enables embedded e-invoice XML such as Factur-X and ZUGFeRD).
- XMP metadata.
- AES-256 encryption and permissions.

**Exit:** the sample suite passes veraPDF for each claimed profile in CI, and passes Acrobat's accessibility checker by hand.

## M6 — Advanced

_Status: in progress. Done: barcodes (Code 128, EAN-13, EAN-8, UPC-A, Code 39, ITF, ITF-14) and the chart kit (bar, line, pie) with text on `Canvas`. The rest waits for demand._

Order within this milestone follows user demand.

- Complex scripts through `@mbingpdf/harfbuzz`; bidirectional text; more hyphenation packs.
- Interactive forms (AcroForm).
- Digital signatures (PAdES).
- Barcodes; a small chart kit on `Canvas`.
- Reading existing PDFs: merge, split, stamp, fill forms (after 1.0).
- A constrained HTML subset importer for rich-text fields.

## 1.0 criteria

- API unchanged for two consecutive minor releases.
- Every claimed standard validated in CI.
- Used in production in both of our own apps.
- Documentation covers every public element and option.
