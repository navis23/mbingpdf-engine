# 06 — Quality strategy

"Production grade" is a claim we have to be able to prove on every commit. A PDF library's bugs are visual and viewer-specific, so unit tests alone are not enough.

## Test layers

| Layer | What it catches | Tool |
| --- | --- | --- |
| Unit | Wrong logic in parsers, shaper, line breaker, layout maths | Vitest |
| Layout snapshot | An element moved or changed size | JSON dump of the fragment tree, compared to a stored copy |
| Structural | Invalid PDF syntax, broken xref, bad streams | `qpdf --check` on every generated sample |
| Visual regression | Output looks different | Render pages to PNG with pdf.js and PDFium, pixel-diff against approved images |
| Conformance | Standard violations | veraPDF for PDF/A and PDF/UA profiles |
| Text extraction | Copy, search and screen readers get wrong text | Extract with pdf.js and compare to the input string |
| Cross-runtime | Behaviour differs between runtimes | Same suite on Node, Bun, Deno and Chromium; output bytes must be identical |
| Fuzz | Crashes on hostile fonts and images | Mutated font and image files into the parsers |
| Performance | Regressions in speed, memory, bundle size | Benchmarks with budgets that fail CI |

## Precision rules

- Layout snapshots store positions to 3 decimals of a point. Any change shows up in review as a diff.
- Deterministic mode is on for all tests, so a byte-level change in output is always attributable to a code change.
- Text measurement is checked against HarfBuzz for a fixed corpus of strings and fonts; advance widths must match exactly for simple scripts.
- Line breaking runs the official Unicode conformance test files for UAX #14, UAX #9 and UAX #29.

## Corpora

- **Fonts:** a pinned set covering TrueType, CFF, variable, colour and large CJK fonts (Noto, Inter, Roboto, Source families and others with permissive licences).
- **Images:** PNG suite (PngSuite), JPEGs in baseline, progressive, CMYK and with ICC profiles.
- **Documents:** the starter templates, plus stress documents (long tables, deep nesting, thousands of pages, every element).

## Viewer matrix

Automated: pdf.js (Firefox's engine) and PDFium (Chrome's engine).

Manual before each minor release: Adobe Acrobat (including Preflight and the accessibility checker), macOS Preview, and one mobile viewer on iOS and Android.

## Release discipline

- Semantic versioning, with Changesets producing the changelog.
- Any change to visual output of an existing sample is listed in the release notes, even in a patch.
- npm provenance on published packages; dependencies pinned and reviewed.
- Supported-runtime list tested, not assumed.
