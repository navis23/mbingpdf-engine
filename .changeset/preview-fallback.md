---
"@mbingpdf/react": patch
"@mbingpdf/vue": patch
---

`PdfPreview` takes a `fallback` (a prop in React, a slot in Vue), shown until the document has been laid out for the first time and in server rendering. In React, `usePdf` with `lazy: true` no longer loops ("Maximum update depth exceeded") when the document is a new object on every render.
