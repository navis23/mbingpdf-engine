# @mbingpdf/vue

Show an [mbingpdf](https://github.com/navis23/mbingpdf-engine) document on screen in a Vue or Nuxt app, and make the PDF file from the same definition.

```sh
npm install mbingpdf @mbingpdf/vue
```

Needs Vue 3.5 or later.

## Preview

```vue
<script setup lang="ts">
import { computed } from "vue";
import { Document, Page, Text } from "mbingpdf";
import { PdfPreview } from "@mbingpdf/vue";

const props = defineProps<{ invoice: { number: string } }>();
const document = computed(() =>
  Document(Page({ size: "A4", margin: 36 }, Text(`Invoice ${props.invoice.number}`))),
);
</script>

<template>
  <PdfPreview :document="document" />
</template>
```

`PdfPreview` draws the pages exactly as the PDF will have them: the same line breaks, the same page breaks. Pages take the width of the element around them, so the preview is readable on a phone. Each page is drawn only when it comes near the screen, so long documents open at once. Links work, both to the web and within the document.

The document is laid out again whenever the `document` prop changes. Build it in a `computed`, as above, so that happens only when the data changes.

| Prop | |
| --- | --- |
| `document` | The document to show |
| `gap` | Space between pages in CSS pixels; default 16 |
| `debug` | Outline every element's box |
| `page-class`, `page-style` | For each page; the default is a white sheet with a light shadow |

| Event | |
| --- | --- |
| `layout` | `{ pages }`, after each layout |
| `error` | The error, when the document cannot be laid out |

The `error` slot replaces the message shown in place: `<template #error="{ error }">…</template>`.

## The file

```vue
<script setup lang="ts">
import { usePdf } from "@mbingpdf/vue";

const pdf = usePdf(document);
</script>

<template>
  <button :disabled="pdf.loading.value" @click="pdf.download('invoice.pdf')">Download</button>
</template>
```

`usePdf(document, options?)` takes a ref, a `computed` or a function, and returns `{ bytes, url, error, loading, download }`; all but `download` are refs. `url` can be the `href` of a link or the `src` of an `<iframe>`; `bytes` can be uploaded to a server. The options are those of `render()`.

To make a file without the composable, call `render()` from `mbingpdf` and pass the bytes to `downloadPdf(bytes, filename)`.

## Notes

- Text in embedded fonts is drawn as shapes, so the preview needs no web fonts. Text in the 14 standard PDF fonts uses the closest font on the device and may differ slightly from the PDF.
- Text in the preview cannot be selected; the PDF's text can.
- Layout happens in the browser. During server rendering (Nuxt) the component gives an empty element, and `usePdf` waits until the page is in the browser.

MIT licence.
