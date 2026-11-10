# 01 — Landscape

Surveyed November 2026. Notes combine a web search with prior working knowledge of these libraries; items marked *(verify)* should be rechecked against the project's own repository before we quote them publicly.

## The four approaches

Every JS PDF tool takes one of four approaches. The approach decides the ceiling, more than the individual library does.

| Approach | Examples | Strength | Ceiling |
| --- | --- | --- | --- |
| Imperative drawing | jsPDF, PDFKit, pdf-lib | Small, direct, full control | You compute every position and page break yourself |
| Declarative layout | pdfmake, @react-pdf/renderer, pdfme | Describe the document, engine places it | Limited by the engine's layout and typography |
| Browser print | Puppeteer, Playwright, Gotenberg | Full HTML and CSS | Ships Chromium (~100 MB), slow, weak paged-media control |
| Typesetting system | Typst, LaTeX, Prince, WeasyPrint | Best typography and standards support | Not a JS library; own language or commercial licence |

## Library notes

### jsPDF
- The most downloaded and oldest browser option.
- Coordinate-based API: `doc.text("Hello", 10, 10)`. No layout engine; tables need the separate `jspdf-autotable` plugin.
- Custom and Unicode fonts need a manual conversion and registration step.
- `html()` goes through html2canvas, so output is often a rasterised image: blurry, not selectable, large.
- Slows down noticeably on complex documents.

### PDFKit
- Mature low-level Node library with a stream-based API. Good font handling through fontkit.
- Text wrapping and simple columns are built in; everything else is manual positioning.
- Browser use needs bundler shims for Node built-ins.

### pdfmake
- Declarative JSON document definition on top of PDFKit. Tables, lists, columns, automatic page breaks, headers and footers.
- Styling model is shallow (no flex or grid, limited box model), types are loose, fonts ship through a virtual file system that inflates bundles.

### pdf-lib
- Creates and modifies PDFs, pure TypeScript, runs everywhere. Often still recommended as "the modern choice".
- The original package has had no release since November 2021. The `@cantoo/pdf-lib` fork is the active successor (v2.7.1, updated May 2026), but its maintainers state they only support what their own roadmap needs.
- No layout engine at all. Custom fonts need `@pdf-lib/fontkit`.

### @react-pdf/renderer
- React renderer with its own layout engine (Yoga flexbox) that writes PDF primitives directly; about 2 MB against Chromium's 100 MB.
- The closest existing thing to what we want. Known pain points *(verify)*: no real table primitive, page-break behaviour that is hard to control, slow on documents of hundreds of pages, requires React, limited tagged-PDF support.

### pdfme
- Template-based: a WYSIWYG designer produces a JSON template, the generator fills it. Good for fixed-layout forms and labels, weak for flowing documents.

### Puppeteer / Playwright
- Render HTML with real Chromium and print to PDF. Best choice when the HTML already exists.
- Cost: a browser binary per server, cold starts, memory, and limited paged-media CSS (running headers, footnotes, cross-references).

### Typst
- Not JS, but the quality bar to aim at. Writes tagged PDF by default, supports PDF/UA-1 and all four PDF/A parts, and refuses to emit a file that violates the selected standard.
- Own markup language and Rust compiler; usable from JS only through WASM or a CLI.

### Commercial SDKs
- Apryse, Nutrient, IronPDF, Prince, DocRaptor. Complete, but licensed per server or per document, and closed.

## Gaps nobody in open-source JS fills

1. **Pagination as a first-class concern.** Keep-together, keep-with-next, widow and orphan control, repeated table headers, and "page X of Y" all exist in pieces, never together.
2. **Real typography without a browser.** OpenType shaping, proper line breaking, hyphenation, justified text and font fallback are partial everywhere.
3. **Standards by default.** No mainstream JS generator produces validated PDF/UA or PDF/A output out of the box.
4. **Types that guide.** Most APIs are loosely typed; mistakes surface as a wrong-looking PDF rather than a compile error.
5. **One engine, every runtime.** Libraries are either browser-first with Node shims or Node-first with browser shims.
6. **Deterministic output.** Byte-identical results across runs and runtimes, needed for caching, signing and snapshot tests.

Those six gaps are the product.

## Sources

- [Top JavaScript PDF generator libraries for 2026 — Nutrient](https://www.nutrient.io/blog/top-js-pdf-libraries/)
- [pdf-lib vs jsPDF vs pdfmake (2026) — PkgPulse](https://www.pkgpulse.com/guides/pdf-lib-vs-jspdf-vs-pdfmake-pdf-generation-nodejs-2026)
- [Comparing open source PDF libraries (2025 edition) — Joyfill](https://joyfill.io/blog/comparing-open-source-pdf-libraries-2025-edition)
- [@cantoo/pdf-lib README](https://unpkg.com/@cantoo/pdf-lib@2.7.1/README.md)
- [@cantoo/pdf-lib — Depscope](https://depscope.dev/pkg/npm/@cantoo/pdf-lib)
- [Typst PDF reference](https://typst.app/docs/reference/pdf/)
- [PDF Accessibility and Standards — Quarto](https://quarto.org/docs/blog/posts/2026-03-05-pdf-accessibility-and-standards)
- [Puppeteer vs @react-pdf/renderer: a production comparison — DEV](https://dev.to/iurii_rogulia/pdf-generation-on-the-server-puppeteer-vs-react-pdfrenderer-a-production-comparison-44cg)
- [@react-pdf/renderer vs puppeteer — devpick](https://devpick.pages.dev/puppeteer-vs-react-pdf-renderer)
