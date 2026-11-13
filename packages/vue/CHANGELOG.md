# @mbingpdf/vue

## 0.1.2

### Patch Changes

- 0264f07: `PdfPreview` takes a `fallback` (a prop in React, a slot in Vue), shown until the document has been laid out for the first time and in server rendering. In React, `usePdf` with `lazy: true` no longer loops ("Maximum update depth exceeded") when the document is a new object on every render.
- Updated dependencies [0264f07]
  - mbingpdf@0.2.2

## 0.1.1

### Patch Changes

- 9cc1340: The packages' home page is now the website, https://mbingpdf.enterbiner.com, with a playground and the documentation.
- Updated dependencies [0996cba]
- Updated dependencies [4b1c252]
- Updated dependencies [9cc1340]
  - mbingpdf@0.2.0

## 0.1.0

### Minor Changes

- aa20853: First release. `PdfPreview` shows an mbingpdf document page by page as the PDF will have it, with working links, a label and the page's text for screen readers. `usePdf` makes the file (on every change, or with `lazy` when asked); `downloadPdf` saves bytes as a file. Works in Nuxt.

### Patch Changes

- Updated dependencies [aa20853]
  - mbingpdf@0.1.0
