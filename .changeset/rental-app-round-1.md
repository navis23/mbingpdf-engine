---
"mbingpdf": patch
---

Fixes from the second app to adopt the library:

- A page's content starts below that page's own header and stops above its own footer, so a header that is absent on the first page and a running head on the rest no longer overprints the text.
- A heading is not left alone at the foot of a page when it is the first thing in its box and the paragraph after it moves on.
- `height: "100%"` inside an `Absolute` no longer throws ("Cannot write Infinity to a PDF"): a percentage there is a share of the box the `Absolute` fills, and an `Absolute` given both `top` and `bottom` is as tall as the space between them.
- Letter-spaced text is copied as whole words (`TANGGAL`, not `TA N G GA L`) by poppler-based readers: the spacing is written as character spacing, with the text as `ActualText`. It looks exactly the same.
- A theme made in a function can be registered (`theme: ReturnType<typeof makeTheme>`) without a circular type.
- `leading` (line height in points) is accepted on every element, not only in theme text styles.
- `inspect()` reports the page background too, before the header.
