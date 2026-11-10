# mbingpdf

A TypeScript library for generating production-grade PDF documents in any JavaScript runtime: browsers, Node, Bun, Deno and edge functions.

**Status: early development.** Nothing is published to npm yet. The low-level writer (`mbingpdf/core`) can produce multi-page PDFs with vector graphics and standard-font text; fonts, layout and the declarative API come next. The design is in [`docs/`](./docs/README.md).

## Development

```sh
pnpm install
pnpm check          # lint, typecheck, test, build
pnpm test:update    # approve changed output (golden images and digests) after reviewing it
pnpm test:runtime   # built package gives byte-identical output on Node, Deno and Chromium
```

The tests use `qpdf` for structural checks when it is installed, and render every sample with pdf.js and PDFium to compare against approved images in `packages/mbingpdf/test/golden/`.

## Goals

- Describe a document; the engine handles layout, page breaks, headers and footers.
- Text measured from the font itself, so output is identical on every runtime.
- Print-ready: CMYK, bleed, trim marks, PDF/X-4.
- Typed themes: brand fonts, colours and styles defined once.
- Framework-neutral, with optional React and Vue preview components.

## Licence

MIT
