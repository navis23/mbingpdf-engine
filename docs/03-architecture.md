# 03 — Architecture

## Pipeline

A document passes through five stages. Each stage has plain-data input and output, so each can be tested alone.

```
 Document tree        what the user writes (objects or JSX)
      │  resolve      apply theme, inherit styles, load fonts and images
      ▼
 Styled tree          every node has final computed style
      │  layout       measure text, size boxes, split across pages
      ▼
 Page fragments       positioned boxes, lines and glyph runs per page
      │  paint        convert fragments to drawing commands + tag structure
      ▼
 Display list         device-independent drawing commands
      │  write        emit PDF objects, fonts, images, xref
      ▼
 PDF bytes            Uint8Array or a ReadableStream
```

The display list is the seam between "layout engine" and "PDF writer". The low-level drawing API writes to it directly. A second backend turns it into SVG, so an app can show the document on screen (including on phones, where inline PDF viewing is unreliable) from the same definition that produces the file.

## Where rendering runs

Browser and server are both first-class. The engine is pure TypeScript with no I/O, so supporting both costs little; what differs is which one constrains the design and which one gets tuned first.

| | In the browser | On the server |
| --- | --- | --- |
| Cost | None; the user's device does the work | Compute per document |
| Speed felt by the user | Instant, works offline | A network round trip |
| Data | Never leaves the device | Sent to, or already on, the server |
| Result | A download or preview for that user | A stored file that can be emailed, sent by WhatsApp, archived or batch-produced |
| Trust | The user's device made it, so it can be altered | The authoritative copy |
| Limits | Bundle and font download size, slow phones, memory on huge batches | Serverless time, memory and response-size caps |

**Design to the browser's limits, because they are the stricter ones:** small bundle, no file system, fonts passed as bytes, everything runnable inside a Web Worker so the page never freezes. Code that satisfies those runs on any server unchanged, including Deno-based edge functions.

**Recommended use in an app:**

- Preview and one-off downloads: in the browser, in a worker.
- Anything sent to a customer, stored as a record, or produced in bulk (invoices, receipts, thousands of bibs): on the server, saved to storage, delivered as a link or attachment.

Because both paths run the same code in deterministic mode, the browser preview and the server file are identical.

## Layers

### 1. Writer (`mbingpdf/core`)

Knows the PDF file format and nothing about layout.

- Object model: dictionaries, arrays, names, strings, streams, indirect references.
- Serialiser with cross-reference streams and object streams (PDF 1.5+), classic xref tables as an option for old consumers.
- Streaming output: finished pages are flushed, so memory stays flat on very large documents.
- Content-stream builder: paths, text, images, transforms, clipping, transparency, gradients, patterns.
- Document features: metadata (Info and XMP), outlines, links, named destinations, page labels, attachments, viewer preferences.
- Colour: DeviceRGB, DeviceCMYK, spot (Separation) colours, ICC-based spaces and output intents.
- Page boxes for print: MediaBox, BleedBox, TrimBox; crop and registration marks; PDF/X-4 conformance.
- Shared resources: a font, image or repeated graphic (Form XObject) is embedded once however many pages use it.
- Structure tree for tagged PDF.
- Encryption (AES-256, PDF 2.0 style), later signatures.
- Deterministic mode: fixed IDs and dates so identical input gives identical bytes.

### 2. Fonts and text (`mbingpdf/font`, `mbingpdf/text`)

The layer that decides whether output looks professional.

- Parsers for TrueType, OpenType/CFF and WOFF2, including variable-font instancing.
- Subsetting: embed only the glyphs used. Emit `ToUnicode` maps so text stays searchable and copyable.
- The 14 standard PDF fonts with bundled metrics for zero-config use (disabled in PDF/A mode, which requires embedding).
- Shaping: characters to positioned glyphs through GSUB and GPOS (kerning, ligatures, marks, contextual forms).
- Font fallback: a chain per script, so one missing glyph does not become a blank box.
- Line breaking by the Unicode algorithm (UAX #14), bidirectional reordering (UAX #9), grapheme segmentation.
- Hyphenation with per-language pattern files loaded on demand.
- Justification, tab stops, letter and word spacing, case transforms, `tabular-nums` and other OpenType features.
- Fit-to-width text: shrink a line to its box between a minimum and maximum size (names on certificates, numerals on bibs).

**Shaper strategy.** A built-in TypeScript shaper covers Latin, Cyrillic, Greek, CJK and other scripts that need only simple substitution and positioning. Our own documents are English and Indonesian, so this is all v1 needs. Complex scripts (Arabic, Indic, Thai and others) go through a `Shaper` interface, with an optional `@mbingpdf/harfbuzz` package that plugs in HarfBuzz compiled to WASM. This keeps the core small without capping script coverage.

### 3. Layout (`mbingpdf/layout`)

- Box model: margin, border, padding, width and height with min and max, in pt, mm, cm, in or percent.
- Flow containers: vertical stack and horizontal row with flexbox semantics (grow, shrink, basis, gap, align, justify, wrap).
- Tables: fixed and auto column widths, row and column spans, header and footer rows repeated on each page, rows that may or may not split.
- Inline layout: mixed fonts, sizes, colours, links, inline images and inline boxes within a paragraph.
- Grid: fixed rows and columns in exact units, for label sheets and several-up printing (two bibs per sheet).
- Absolute and page-anchored positioning, with rotation, for watermarks, stamps and letterheads.
- Multi-column sections.

**Fragmentation is built in, not bolted on.** Every layout node implements "lay out into this much space, and return what did not fit". This is why we write our own flex implementation rather than use Yoga: Yoga computes one unbounded layout and cannot split a node across pages, which is the root of react-pdf's page-break problems.

Pagination controls: `break: before | after | avoid`, `keepTogether`, `keepWithNext`, `widows`, `orphans`, repeated headers, and page templates (different first page, odd/even margins, per-section size and orientation).

**Total page count** ("Page 3 of 12") needs the layout to finish before text is final. Layout runs once with a reserved width for the counter and patches the value afterwards; a second pass runs only if the reserved width was wrong.

### 4. Images and vector (`mbingpdf/image`)

- JPEG embedded without re-encoding. PNG decoded to image plus soft mask, with ICC profile carried over.
- SVG converted to native vector paths, not rasterised.
- QR codes drawn as a single vector path.
- Effective-resolution check: warn when an image will print below a set DPI.
- Later: WebP and AVIF through the runtime's decoder where one exists; other barcodes.

### 5. Public API (`mbingpdf`)

Described in [04-api-design.md](./04-api-design.md). It is a thin layer: element factory functions, the theme system, and `render()`.

## Packaging

One published package with subpath exports, plus separate packages only where a dependency is heavy or optional.

| Package | Contents |
| --- | --- |
| `mbingpdf` | Everything above. Entry points: `mbingpdf`, `mbingpdf/core`, `mbingpdf/svg`, `mbingpdf/jsx-runtime` |
| `@mbingpdf/vue` | `<PdfPreview>` component and composables for Vue and Nuxt |
| `@mbingpdf/harfbuzz` | WASM shaper for complex scripts |
| `@mbingpdf/react` | `<PdfPreview>` component and hooks for React |
| `@mbingpdf/dev` | Preview server and CLI |
| `@mbingpdf/hyphenation-*` | Language pattern files |

A single core package means one version number and no cross-package version mismatches. Internally the source is still split into the layers above, with lint rules forbidding a lower layer from importing a higher one.

## Technical choices

| Choice | Decision | Reason |
| --- | --- | --- |
| Language | TypeScript, `strict` | The types are part of the product |
| Module format | ESM and CJS builds, `sideEffects: false` | Widest compatibility, tree-shakeable |
| Runtime floor | Node 22+, current evergreen browsers, Deno, Bun, Workers | Node 20 reached end of life in April 2026 |
| Platform APIs | `Uint8Array`, Web Streams, `TextEncoder` only | Present in every target; no `Buffer`, `fs` or `stream` in core |
| Compression | Bundled synchronous deflate (fflate or equivalent) | `CompressionStream` is async-only and its output differs by runtime, which breaks determinism |
| Runtime dependencies | Zero or near zero; anything adopted is small, audited and pinned | Supply-chain risk and bundle size |
| Coordinates | Top-left origin, y grows downward in the public API | Matches how everyone thinks about pages; the writer flips to PDF's bottom-left |
| Internal unit | PDF point (1/72 in) as float64; rounded to 3 decimals on output | Exact and compact |
| File loading | The core takes bytes; `mbingpdf/node` and `mbingpdf/web` add path and URL helpers | Keeps the core free of I/O |
| Repo | pnpm workspace, tsdown build, Vitest, Biome, Changesets | Current, fast, low-config tooling |

## Risks

| Risk | Mitigation |
| --- | --- |
| Text shaping is a large problem | Ship simple-script shaping first, define the `Shaper` interface early, delegate complex scripts to HarfBuzz |
| Font parsing has endless edge cases | Test against a corpus of real fonts (Google Fonts, Noto, common system fonts); fuzz the parsers |
| Layout engine scope creep toward CSS | The non-goal is written down; every new layout feature needs a real document that requires it |
| Viewer differences | Render tests through more than one engine (pdf.js and PDFium); manual Acrobat check per release |
| Performance on 1,000-page tables | Benchmarks in CI from the first layout milestone, with a budget that fails the build |
