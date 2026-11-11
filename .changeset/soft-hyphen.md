---
"mbingpdf": patch
---

A hyphen that hyphenation adds at a line break now reads as a soft hyphen (U+00AD) in files with embedded fonts, as tagged PDF requires: screen readers and copied text get the word whole, while the hyphen is drawn as before. Real hyphens are unchanged.
