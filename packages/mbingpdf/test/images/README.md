# Test images

- `photo*.jpg` — generated with ImageMagick for these tests (baseline, progressive, greyscale,
  CMYK). They contain no third-party material.
- `pngsuite/` — PngSuite by Willem van Schaik, the standard set of PNG test images: every
  colour type and bit depth, interlacing, transparency, filters, odd sizes, and deliberately
  corrupt files (names starting with `x`). See `pngsuite/PngSuite.LICENSE`; from
  <http://www.schaik.com/pngsuite/>.
- `webp/` — WebP files made by `webp/make.sh` with ImageMagick and libwebp, from synthetic
  pictures (plasma fractals, gradients) and `photo.jpg`; no third-party material. Each covers one
  part of the format (both loop filters, segments, partitions, palettes, alpha coding and
  filters). `expected.json` holds the SHA-256 of the RGBA pixels libwebp decodes each file to.
