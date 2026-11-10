---
"mbingpdf": minor
---

First release.

- Document API: `Document`, `Page`, `Stack`, `Row`, `Box`, `Text`, `Span`, `Link`, `Heading`, `List`, `Table`, `Columns`, `Grid`, `Image`, `Svg`, `QrCode`, `Canvas`, `Absolute`, `Spacer`, `PageBreak`, `TableOfContents`, rendered with `render()`.
- Pagination: forced breaks, keep-together, keep-with-next, widows and orphans, repeated table headers, headers and footers with page number and total.
- Fonts: TrueType, OpenType/CFF and WOFF2 with subsetting, shaping (ligatures, kerning, accents), variable-font instancing and fallback; the 14 standard fonts.
- Text: Unicode line breaking, hyphenation for English and Indonesian, justification, fit-to-width.
- Themes with `defineTheme`; JSX through `mbingpdf/jsx-runtime`.
- Print: CMYK and spot colours, bleed, crop and registration marks, ICC output intent, PDF/X-4.
- SVG preview with `renderSvg` from `mbingpdf/svg`.
- Lower layers on their own: `mbingpdf/core`, `mbingpdf/font`, `mbingpdf/text`, `mbingpdf/image`, `mbingpdf/qr`.
