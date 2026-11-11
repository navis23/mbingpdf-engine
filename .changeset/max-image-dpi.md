---
"mbingpdf": patch
---

`render(document, { maxImageDpi: 300 })` stores an image that has far more pixels than its place on the page needs at that resolution instead, so a large upload drawn as a small logo adds a few kilobytes, not hundreds. It applies to PNG and WebP images (and anything else `loadImage` decodes); JPEG files are embedded as they are. `shrinkImage(image, width, height)` in `mbingpdf/image` does the same by hand.
