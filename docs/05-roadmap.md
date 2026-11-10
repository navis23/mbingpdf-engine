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

_Status: in progress — done and checked against HarfBuzz: TrueType parsing, glyph subsetting, CID embedding with `ToUnicode`, and shaping for simple scripts (GSUB ligatures and alternates, GPOS kerning and mark attachment, feature toggles, the `Shaper` interface). Still to do: variable-font instancing, CFF, WOFF2, line breaking, justification, fit-to-width, hyphenation, fallback_

- TrueType and OpenType/CFF parsing, WOFF2 decoding, variable-font instancing.
- Glyph subsetting, CID font embedding, `ToUnicode` maps.
- Simple-script shaping: kerning, ligatures, mark positioning, OpenType feature toggles.
- Line breaking (UAX #14), grapheme segmentation, alignment, justification, letter and word spacing, case transforms.
- Fit-to-width text.
- Hyphenation for English and Indonesian.
- Font fallback chains. The `Shaper` interface.

**Exit:** a paragraph in a custom font with mixed weights wraps, justifies, and copies out of Acrobat as correct Unicode. Embedded font size is within 10% of the subset HarfBuzz's tooling produces for the same glyphs.

## M2 — Layout and pagination

_Status: not started_

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

_Status: not started_

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

_Status: not started_

- JSX runtime.
- `@mbingpdf/react` and `@mbingpdf/vue` preview components.
- Preview server with hot reload and debug overlay.
- Warnings with element paths, strict mode, `inspect()`.
- Documentation site with runnable examples; starter templates.
- Bundle-size budget enforced in CI.
- Benchmarks published against PDFKit, pdfmake and @react-pdf/renderer.

**Exit:** `0.1.0` on npm. The rental agreement with inspection report (third acceptance document) is rebuilt and one document type in each of our two apps is switched from browser print to mbingpdf. A developer who has never seen the library produces a branded invoice from the quick-start in under fifteen minutes.

## M5 — Archival and accessibility standards

_Status: not started_

- Tagged PDF generated from element semantics; alt text, language, reading order, table header associations.
- PDF/UA-1 and PDF/A-2b, A-2u, A-3b (A-3 enables embedded e-invoice XML such as Factur-X and ZUGFeRD).
- XMP metadata.
- AES-256 encryption and permissions.

**Exit:** the sample suite passes veraPDF for each claimed profile in CI, and passes Acrobat's accessibility checker by hand.

## M6 — Advanced

_Status: not started_

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
