# @mbingpdf/react

Show an [mbingpdf](https://github.com/navis23/mbingpdf-engine) document on screen in a React app, and make the PDF file from the same definition.

```sh
npm install mbingpdf @mbingpdf/react
```

## Preview

```tsx
import { useMemo } from "react";
import { Document, Page, Text } from "mbingpdf";
import { PdfPreview } from "@mbingpdf/react";

function InvoicePreview({ invoice }) {
  const document = useMemo(
    () => Document(Page({ size: "A4", margin: 36 }, Text(`Invoice ${invoice.number}`))),
    [invoice],
  );
  return <PdfPreview document={document} />;
}
```

`PdfPreview` draws the pages exactly as the PDF will have them: the same line breaks, the same page breaks. Pages take the width of the element around them, so the preview is readable on a phone. Each page is drawn only when it comes near the screen, so long documents open at once. Links work, both to the web and within the document.

The document is laid out again whenever the `document` prop changes. Build it with `useMemo`, as above, so that happens only when the data changes.

| Prop | |
| --- | --- |
| `document` | The document to show |
| `gap` | Space between pages in CSS pixels; default 16 |
| `debug` | Outline every element's box |
| `pageLabel` | What a screen reader calls each page: `(page, pages) => string`; default `Page 1 of 3`. The page's text follows it |
| `className`, `style` | For the element around all pages |
| `pageClassName`, `pageStyle` | For each page; the default is a white sheet with a light shadow |
| `onLayout` | Called with `{ pages }` after each layout |
| `onError` | Called when the document cannot be laid out; without it the message is shown in place |

## The file

```tsx
import { usePdf } from "@mbingpdf/react";

function DownloadButton({ document }) {
  const pdf = usePdf(document);
  return (
    <button disabled={pdf.loading} onClick={() => pdf.download("invoice.pdf")}>
      Download
    </button>
  );
}
```

`usePdf(document, options?)` returns `{ bytes, url, error, loading, make, download }`. `url` can be the `href` of a link or the `src` of an `<iframe>`; `bytes` can be uploaded to a server. The options are those of `render()`.

To make a file without a hook, call `render()` from `mbingpdf` and pass the bytes to `downloadPdf(bytes, filename)`.

With `usePdf(document, { lazy: true })` nothing is made until `pdf.download(name)` or `pdf.make()` is called: for a large document that should not be rendered again on every change. `make()` gives the bytes.

## Notes

- Text in embedded fonts is drawn as shapes, so the preview needs no web fonts. Text in the 14 standard PDF fonts uses the closest font on the device and may differ slightly from the PDF.
- Text in the preview cannot be selected; the PDF's text can. Screen readers are given each page's text.
- Layout happens in the browser. During server rendering the component gives an empty element.

MIT licence.
