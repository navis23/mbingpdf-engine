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

Decisions 8–10 and 16–33 were made by the plan's author under delegated authority and can be revisited: 8 if a customer or regulator asks for archival or accessible files, 9 when a print shop names a different profile.

## Assumed until someone objects

| # | Decision | Assumption |
| --- | --- | --- |
| 11 | Licence | MIT |
| 12 | Authoring style | Function elements as the base, JSX as optional sugar over the same data |
| 13 | HTML input | Out of scope, except a small rich-text subset after 1.0 |
| 15 | Module format | Ship both ESM and CJS |
