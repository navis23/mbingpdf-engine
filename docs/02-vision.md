# 02 — Vision

## What we are building

A TypeScript library that turns a description of a document into a PDF a large company would be willing to send to customers, auditors and print shops.

Typical documents: invoices, receipts, statements, contracts, reports with long tables, certificates, race bibs and label sheets. The concrete list we design against is in [08-target-documents.md](./08-target-documents.md).

It replaces the "HTML page plus `window.print()`" pattern, which leaves the result to each user's browser and print dialog and never produces a file the app can send or store.

## Who it is for

- **Application developers** who need a PDF from data and want to describe it, not position it.
- **Design-minded teams** who need the output to match a brand: exact fonts, spacing, colours and grids.
- **Platform teams** who generate thousands of documents on servers, in serverless functions, or in the user's browser.

## Principles

Each principle is a tie-breaker. When two designs compete, the one that serves the earlier principle wins.

1. **Correct output first.** A file that opens cleanly in Acrobat, Chrome, Firefox, Preview and print RIPs, and passes validators. A feature that produces invalid PDF is not shipped.
2. **Precise.** Positions are exact to a thousandth of a point. Text is measured from the font's own metrics, never from a browser. The same input gives the same bytes on every runtime.
3. **Easy for the common case.** An invoice with a logo, a table and a footer takes about thirty lines and no coordinate maths.
4. **Possible for the hard case.** Every high-level element can be bypassed down to raw drawing operators. No dead ends.
5. **Typed end to end.** Wrong property names, wrong units and wrong nesting are compile errors with readable messages.
6. **Runs everywhere unchanged.** Node, Bun, Deno, browsers, web workers, edge functions. No native modules, no Node built-ins in the core.
7. **Small.** Pay only for what is imported. A "hello world" bundle stays under a stated budget (target: 60 kB gzipped; see the roadmap).
8. **Accessible by default.** Headings, paragraphs, tables and lists carry their meaning into the PDF's tag tree without extra work.

## How we are better, concretely

| Area | Today's norm | mbingpdf |
| --- | --- | --- |
| Positioning | Manual x/y, or shallow layout | Box model, flex rows and columns, tables, absolute positioning as an escape hatch |
| Page breaks | Automatic but uncontrollable | `keepTogether`, `keepWithNext`, widow and orphan limits, repeated table headers, forced breaks |
| Headers and footers | Static, or a callback | Regions with access to page number, total pages and the current section title |
| Fonts | Register a converted file | Pass TTF, OTF or WOFF2 bytes; automatic subsetting, fallback chains, variable-font instances |
| Text | Greedy wrap, basic kerning | OpenType shaping, Unicode line breaking, hyphenation, justification, bidirectional text |
| Colour | RGB | RGB, CMYK, spot colours, ICC output intents for print |
| Print | Not addressed | Bleed, trim and crop marks, PDF/X-4, low-resolution image warnings |
| Preview | Open the PDF | The same document renders to SVG for an on-screen preview that works on phones |
| Standards | None | Tagged PDF, PDF/UA-1, PDF/A-2 and A-3, validated in CI |
| Errors | Broken PDF or silent overflow | Typed inputs, layout warnings with the element path, strict mode that throws |
| Debugging | Open the file and look | Live preview server, layout-box overlay, JSON dump of the laid-out tree |

## Non-goals

Stating these keeps the first version achievable.

- **Not an HTML/CSS renderer.** We will not chase browser fidelity. A small HTML subset importer for rich-text fields may come later.
- **Not a PDF viewer.** Rendering to screen is pdf.js's job.
- **Not a PDF editor in v1.** Parsing and modifying existing files (merge, fill forms, sign) is a later milestone built on the same core; see open decisions.
- **Not a WYSIWYG designer in v1.** The document model is plain data so a designer can be built on it later.
