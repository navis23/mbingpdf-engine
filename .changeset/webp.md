---
"mbingpdf": minor
---

WebP images are read by the library itself, on servers as well as in browsers: `await loadImage(bytes)` now decodes lossy, lossless and transparent WebP files everywhere, and `decodeWebp` from the new `mbingpdf/webp` entry does it synchronously. The pixels are exactly the ones libwebp produces, on Node, Deno, Bun and in browsers. The decoder (about 18 kB gzip) loads only when a WebP file is read. Animated WebP files are refused.
