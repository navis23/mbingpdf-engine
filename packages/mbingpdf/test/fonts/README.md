# Test fonts

Fonts used by the test suite. Each is under the SIL Open Font License 1.1; the licence text for
every family is in this folder. The files are unmodified copies from
<https://github.com/google/fonts>.

| File | Family | Notes |
| --- | --- | --- |
| `Inter-Variable.ttf` | Inter | variable: optical size, weight |
| `JetBrainsMono-Variable.ttf` | JetBrains Mono | variable: weight; monospaced |
| `PlusJakartaSans-Variable.ttf` | Plus Jakarta Sans | variable: weight |
| `BarlowCondensed-Regular.ttf`, `BarlowCondensed-Bold.ttf` | Barlow Condensed | static |
| `SourceSans3-Regular.otf` | Source Sans 3 | static, CFF outlines; from <https://github.com/adobe-fonts/source-sans> |

`BarlowCondensed-Regular.woff2` and `PlusJakartaSans-Variable.woff2` were made from the
corresponding `.ttf` files with Google's `woff2_compress`, to test WOFF2 decoding.
