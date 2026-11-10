# @mbingpdf/dev

The `mbingpdf` command: see an [mbingpdf](https://github.com/navis23/mbingpdf-engine) document in the browser while you write it, and build it into a PDF.

```sh
npm install -D @mbingpdf/dev
```

## The document file

A file whose default export is a `Document`, or a function that returns one (it may be async, to load fonts or data first). TypeScript and JSX work as they are; no configuration is needed.

```tsx
// invoice.tsx
import { Document, Page, Text } from "mbingpdf";

export default (
  <Document title="Invoice">
    <Page size="A4" margin={36}>
      <Text>Hello</Text>
    </Page>
  </Document>
);

// Optional: options for render().
export const options = { deterministic: true };
```

## Preview

```sh
npx mbingpdf dev invoice.tsx
```

Opens a server at `http://127.0.0.1:4173/` that shows the pages exactly as the PDF will have them. Saving the file, or any file it imports, redraws them; the scroll position is kept. The page also has:

- **Outlines** — draws every element's box, to see how a layout is put together;
- a list of **warnings** (a missing glyph, a low-resolution image) with the path of the element;
- **Open PDF** — the real file, made on request;
- errors shown in place when the file does not compile or cannot be laid out, with the last good pages kept behind them.

| Option | |
| --- | --- |
| `-p`, `--port <number>` | Port to listen on; default 4173 |
| `--host <address>` | Address to listen on; default `127.0.0.1` (this computer only). Use `0.0.0.0` to look at the preview from a phone on the same network |
| `--open` | Open the browser |

Fonts and images that the file reads from disk are not watched; save the document file again after changing one.

## Build

```sh
npx mbingpdf build invoice.tsx -o out/invoice.pdf
```

| Option | |
| --- | --- |
| `-o`, `--out <file>` | Where to write; default is the file's name with `.pdf` |
| `--debug` | Outline every element's box |
| `--strict` | Treat warnings as errors |

## From code

```ts
import { loadDocument, startPreview } from "@mbingpdf/dev";

const server = await startPreview("invoice.tsx", { port: 0 });
console.log(server.url);
await server.close();

const { document, options, engine } = await loadDocument("invoice.tsx");
const bytes = await engine.render(document, options);
```

`engine` is the copy of mbingpdf installed in the document's project, so the tools and the document always use the same one.

## How it works

The file and what it imports from disk are bundled with [Rolldown](https://rolldown.rs) into `node_modules/.mbingpdf-dev/` and imported from there; packages stay as imports. `import.meta.url` keeps pointing at the original source file, so assets read relative to it are found.

Needs Node 22 or later. MIT licence.
