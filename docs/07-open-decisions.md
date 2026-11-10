# 07 — Decisions

## Decided

| # | Decision | Answer | Date |
| --- | --- | --- | --- |
| 1 | Name | `mbingpdf`. Repository: `navis23/mbingpdf-engine`. The npm names `mbingpdf` and `@mbingpdf/*` were unclaimed on 2026-11-10 | 2026-11-10 |
| 2 | Open source | Public from the first commit | 2026-11-10 |
| 3 | Scope of v1 | Generating PDFs only. Reading and editing existing files comes after 1.0 | 2026-11-10 |
| 4 | First documents | Invoices, reports, certificates; full list in [08-target-documents.md](./08-target-documents.md) | 2026-11-10 |
| 5 | Languages | English and Indonesian. Latin-script shaping only in v1; complex scripts stay an optional later package | 2026-11-10 |
| 6 | Commercial print | In scope. CMYK, bleed, trim marks and PDF/X-4 are part of the first release | 2026-11-10 |
| 7 | Runtime | Browser and server both first-class; see "Where rendering runs" in [03-architecture.md](./03-architecture.md) | 2026-11-10 |

| 8 | PDF/A and accessibility | Not treated as a legal requirement for our documents. Tagged PDF, PDF/UA and PDF/A stay in M5. Elements carry their semantic role (heading, table header, list item) from M2, so tagging is added later without changing the API | 2026-11-10 |
| 9 | Print colour target | Default output is sRGB, which digital print shops accept. CMYK is opt-in per document. The reference profile for testing PDF/X-4 is Coated FOGRA39 (ISO Coated v2). Profiles are passed in as bytes and never bundled in the core package | 2026-11-10 |
| 10 | Test fonts | Plus Jakarta Sans, JetBrains Mono, Inter and Barlow Condensed — the four families our apps already use. All are under the SIL Open Font License, so they can sit in the public test corpus. Two ship as variable fonts, so variable-font instancing is required in M1, not optional | 2026-11-10 |
| 14 | Dependencies and deflate | Zero runtime dependencies in the published package. Deflate is fflate, pinned to an exact version and compiled into the build rather than listed as a dependency | 2026-11-10 |
| 16 | Coordinates in `mbingpdf/core` | PDF-native: origin bottom-left, y up. The top-left flip promised for the public API is done by the layer that paints the display list, not by the writer | 2026-11-10 |
| 17 | Text a font cannot show | `content.text()` throws, naming the font and character. Paragraph layout never throws: it falls back through the font list, draws the "missing" box, and lists the characters in `missingCharacters` | 2026-11-10 |
| 18 | Standard-font kerning | Not bundled (about 80 kB for a zero-config fallback). Kerning comes with embedded fonts | 2026-11-10 |
| 19 | Shaping reference | The built-in shaper's output must equal HarfBuzz for the test corpus; `harfbuzzjs` is a dev dependency used as the oracle | 2026-11-10 |
| 20 | Variable fonts | Instanced to a static font before embedding; instances are written without hinting (no `cvar` support) | 2026-11-10 |
| 21 | Line breaking and graphemes | Own implementation of UAX #14 and UAX #29 from Unicode 17 data, not `Intl.Segmenter`, so breaks do not depend on the runtime's ICU version | 2026-11-10 |
| 22 | Hyphenation | English uses the TeX en-US patterns (permissive notice licence). Indonesian uses our own rule-based syllabifier, because the TeX Indonesian patterns are GPL-2 and cannot ship in an MIT package | 2026-11-10 |
| 23 | Line filling | Greedy (first fit). Knuth–Plass optimal breaking can be added later without changing the API | 2026-11-10 |
| 24 | WOFF2 and Brotli | No Brotli decoder is bundled (its dictionary alone is 120 kB). `loadFont()` uses the runtime's own: `node:zlib` on Node, Bun and Deno, `DecompressionStream("brotli")` in browsers. `decodeWoff2()` accepts any decoder for runtimes with neither | 2026-11-10 |
| 25 | CFF fonts | Embedded as a CID-keyed CFF subset (`CIDFontType0C`). The subset keeps every subroutine rather than tracing which are used, so it is larger than HarfBuzz's; correctness first | 2026-11-10 |
| 26 | Font class name | One class, `Font`, for TrueType and CFF outlines (`loadFont()` also takes WOFF2). There is no separate `TrueTypeFont` | 2026-11-10 |
| 27 | Element call style | `Element(props?, ...children)`: properties are optional and children are variadic, so `Text("Hi")` works. Arrays of children are flattened and `null`/`false` skipped | 2026-11-10 |
| 28 | `size` on `Page` | Means the paper size. The default font size for a page is `fontSize`; everywhere else `size` is the font size | 2026-11-10 |
| 29 | Split boxes | A box split across pages is cut open at the split (no bottom border on the first part, no top border on the second) and its background runs to the page edge | 2026-11-10 |
| 30 | Unsplittable content | An image taller than a page is scaled to fit; a fixed-height box is clipped to the page; `keepTogether` is ignored for blocks taller than a page. Layout does not throw for these | 2026-11-10 |
| 31 | Image size without dimensions | 96 pixels per inch (1 px = 0.75 pt), as in CSS, shrunk to the available width | 2026-11-10 |
| 32 | Text in the SVG preview | Embedded fonts are drawn as glyph shapes, so the preview matches the PDF and needs no fonts installed. The 14 standard fonts have no shapes to draw and fall back to `<text>` in a similar system font | 2026-11-10 |
| 33 | Shaping speed | Each OpenType lookup keeps the set of glyphs it can start at, and `Font.shape()` caches results (4,096 entries). Layout of a 53-page report went from 2.2 s to 0.2 s | 2026-11-10 |
| 34 | Table cells and rows | A row is an array of cells; a cell is any child. `TableRow(props, ...)` and `Cell(props, ...)` exist for rows and cells that need properties. Column spans are supported, row spans are not | 2026-11-10 |
| 35 | Table lines | Not CSS border-collapse: a table has up to five kinds of line (outer, between rows, between columns, under the header, above the footer), set with `borders`. Lines take up space | 2026-11-10 |
| 36 | Text wider than its box | A word wider than its column is broken between characters rather than left to overflow | 2026-11-10 |
| 37 | Lists | A list item is one child; an item with several parts is wrapped in a `Stack` (a bare array is flattened into separate items, like any children). Items stay whole across pages unless `splitItems` is set | 2026-11-10 |
| 38 | QR quiet zone | `QrCode` includes the standard four-module quiet zone inside its `size` by default, so a code scans wherever it is placed | 2026-11-10 |
| 39 | Bleed | `Page({ size, bleed })`: `size` is the finished size and coordinates start at its corner. The page `fill` and `background` extend across the bleed; content is clipped at the bleed edge. Marks add 10 mm around the bleed | 2026-11-10 |
| 40 | Metadata | XMP is always written, uncompressed, alongside the information dictionary | 2026-11-10 |
| 41 | PDF/X-4 | Checked when the file is written: an output intent, a trim box on every page and embedded fonts are required, and the standard fonts are refused. No profile is bundled; the test profile is CC0 | 2026-11-10 |
| 42 | Headings | `Heading({ level })` sizes itself from the surrounding text (2, 1.5, 1.25, 1.1, 1, 0.9 times), stays with the next element, and becomes a bookmark and a table-of-contents entry unless `bookmark: false` | 2026-11-10 |
| 43 | Table of contents | Laid out in repeated passes until the page numbers stop changing (at most five); documents without one are laid out once | 2026-11-10 |
| 44 | Links within the document | Any element takes an `id`; `Link({ to })` points at it. Written as named destinations, so forward references work | 2026-11-10 |
| 45 | Columns | Filled one after another and balanced where the content ends; no spanning elements | 2026-11-10 |
| 46 | Long documents | `render()` writes each page to the file as soon as it is painted instead of holding every page's drawing list; documents with a table of contents are written again per layout pass. `layoutDocument()` still returns all pages | 2026-11-10 |
| 47 | Font instances | `font.instance()` returns the same object for the same style, so asking for "Bold" in every paragraph embeds it once | 2026-11-10 |
| 48 | Batch budget | 5,000 A5 bibs with fitted numerals and QR codes: under 60 s and 2.5 kB per bib as a test limit; measured about 10 s, 1.3 kB per bib and 300 MB of memory | 2026-11-10 |
| 49 | Themes | `defineTheme({ fonts, colors, text })` passed as `Document({ theme })`. Names are used directly: `style: "h1"`, `color: "brand"`, `font: "body"` with `weight` and `italic`. Type checking of the names is opt-in through `declare module "mbingpdf" { interface Register { theme: typeof theme } }` | 2026-11-10 |
| 50 | Theme conventions | The `body` text style is the document default; `h1`–`h6` style `Heading`. A style's `leading` (points) is kept as a ratio of the style's size. A font family is a variable font or a set of sources keyed by weight (`"400i"` for italic) | 2026-11-10 |
| 51 | SVG input | `Svg({ src })` reads paths, basic shapes, groups, transforms, solid fills and strokes, opacity and `<use>`, and draws them as vectors. Gradients, patterns, text, images, filters, clipping and masks are not read; a shape that depends on one is drawn plain or skipped. Checked against librsvg | 2026-11-10 |
| 52 | Shared graphics | Deferred from M3 to M4: no Form XObjects yet. Fonts and images are embedded once already | 2026-11-10 |
| 53 | JSX | `jsxImportSource: "mbingpdf"`. Element functions accept `children` as a property, so every tag is a plain function call; fragments and your own function components work; there are no lower-case intrinsic tags. `render()` and `inspect()` take any element and check at run time that it is a `Document` | 2026-11-10 |
| 54 | Diagnostics | `inspect(document)` returns each page's boxes as JSON-safe data rounded to 0.001 pt. Warnings carry the element path where the problem was first met. `strict: true` throws on the first warning. `debug: true` outlines every box | 2026-11-10 |
| 55 | Undefined properties | Any element property may be passed as `undefined` and is dropped when the element is built, so conditional properties need no spreading and an undefined value never overrides a default | 2026-11-10 |
| 56 | Bundle budget | `pnpm size` measures the gzip size of each entry point with everything it imports, untree-shaken, and fails CI when one exceeds `size-budget.json` (current size plus 10%). The whole document API is about 130 kB gzip; `mbingpdf/core` alone 31 kB | 2026-11-10 |
| 57 | Examples | Starter templates live in `examples/` as a private workspace package that imports `mbingpdf` by name; each exports a function from data to a document, plus sample data | 2026-11-10 |
| 58 | Release | Publishing is a manual step: the `Release` workflow is started by hand, defaults to a dry run, and needs the `NPM_TOKEN` secret. Packages are published with npm provenance. No source maps are shipped. Subpath imports need `moduleResolution` `node16` or `bundler` | 2026-11-10 |
| 59 | Preview components | `@mbingpdf/react` and `@mbingpdf/vue` each give `PdfPreview`, `usePdf` and `downloadPdf`, written without JSX or single-file components so they build with the same toolchain. Each page is shown as an `<img>` of its SVG (no script can run, no id clashes between pages), drawn when it nears the screen; links are real `<a>` elements laid on top. Both are built on `previewPages()` in `mbingpdf/svg` | 2026-11-10 |
| 60 | Link safety on screen | The SVG backend and the previews keep only `http`, `https`, `mailto` and `tel` links; anything else (such as `javascript:`) is dropped, because link addresses may come from user data. The PDF keeps every link as written | 2026-11-10 |
| 61 | Framework versions | React 18 or later; Vue 3.5 or later (for `useId`). `mbingpdf` is a peer dependency of both | 2026-11-10 |
| 62 | Preview server | `@mbingpdf/dev` gives the `mbingpdf` command (`dev` and `build`) and the functions behind it. A document file's default export is a Document or a function returning one; an `options` export goes to `render()`. The file is bundled with Rolldown (the package's one dependency) with packages left external, and the engine is imported inside that bundle so the tools and the document share one copy. The browser page is a single HTML file with no framework; it reloads through server-sent events and listens on `127.0.0.1` unless told otherwise | 2026-11-10 |
| 63 | Check order | `pnpm check` and CI build before testing, because the command-line tests run the built packages; without a build those tests are skipped | 2026-11-10 |
| 64 | Shared graphics | Every `Svg` is written to the PDF as a Form XObject: the same source in the same colour is stored once per file and only placed (moved and scaled) wherever it appears. No new element or option; artwork is recognised by its parsed shapes. The display list has a `shared` item for this, which the SVG backend turns into a `<symbol>`. Artwork is cut off at its viewBox, as SVG itself does. `Canvas` drawings and page furniture are not shared | 2026-11-10 |

Decisions 8–10 and 16–58 were made by the plan's author under delegated authority and can be revisited: 8 if a customer or regulator asks for archival or accessible files, 9 when a print shop names a different profile.

## Assumed until someone objects

| # | Decision | Assumption |
| --- | --- | --- |
| 11 | Licence | MIT |
| 12 | Authoring style | Function elements as the base, JSX as optional sugar over the same data |
| 13 | HTML input | Out of scope, except a small rich-text subset after 1.0 |
| 15 | Module format | Ship both ESM and CJS |
