# mbingpdf

A TypeScript library for generating production-grade PDF documents in any JavaScript runtime: browsers, Node, Bun, Deno and edge functions.

**Status: planning.** No code is published yet. The design is in [`docs/`](./docs/README.md).

## Goals

- Describe a document; the engine handles layout, page breaks, headers and footers.
- Text measured from the font itself, so output is identical on every runtime.
- Print-ready: CMYK, bleed, trim marks, PDF/X-4.
- Typed themes: brand fonts, colours and styles defined once.
- Framework-neutral, with optional React and Vue preview components.

## Licence

MIT
