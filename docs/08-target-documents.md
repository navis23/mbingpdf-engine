# 08 — Target documents

The library is designed against real documents from two production apps. Both currently produce PDFs the same way: an HTML page with a print stylesheet and a "Print / Save as PDF" button that calls `window.print()`. Neither uses a PDF library.

## Why browser print is not enough

| Limit of `window.print()` | Effect |
| --- | --- |
| The user's browser makes the file | Output differs between Chrome, Safari and Firefox, and between desktop and phone |
| No file exists until a person saves one | Nothing to attach to an email or a WhatsApp message, nothing to archive; today a link is shared instead |
| The print dialog owns paper size, margins and "background graphics" | A wrong setting drops colours or clips the page |
| RGB only, no bleed, no trim marks | Not acceptable to a commercial printer |
| No header, footer or page-number control | Multi-page documents have no "Page X of Y" |
| Each document is a full DOM | A sheet of 5,000 bibs with QR codes strains the browser |

## Document inventory

### App A — vehicle rental (React single-page app)

| Document | Pages | What it needs from the engine |
| --- | --- | --- |
| Booking confirmation | 1–2 | Letterhead with tenant logo, label–value field grid, line-item table, totals |
| Rental agreement | 2–4 | Long numbered terms, list items that never split across pages, signature block kept together |
| Inspection report | 1–3 | Two-column layout, damage diagram, photo grid (2–4 across), drawn signatures as images |
| Invoice | 1–2 | Line-item table, tabular numerals, currency alignment, payment status |
| Payment receipt | 1 | Compact single block, amount in words |
| Owner statement | 1–n | Grouped lines with subtotals and a grand total over many pages |
| Financial reports | 1–n | Titled sections of labelled amounts, long tables with repeated headers |
| Status stamp | overlay | Rotated bordered text ("Cancelled") over any document |

All use A4 portrait with roughly 12 mm margins, 10.5 pt body text, one sans family plus a monospaced face for numbers, and a per-tenant logo.

### App B — running events (Vue / Nuxt app with a server)

| Document | Pages | What it needs from the engine |
| --- | --- | --- |
| Finisher certificate | 1 | A4 landscape, zero margin, full-bleed frame, vector background pattern at low opacity, wide letter-spacing, a runner name that must shrink to fit one line, organiser theme colour |
| Race bibs | up to thousands | A5 landscape, two per A4 sheet, very large numerals, vector QR code |
| Bag labels | up to thousands | 3 × 8 grid of 70 × 37 mm cells on A4, positions exact to the millimetre |

## What this changes in the plan

1. **Framework-neutral API is mandatory.** One app is React, the other Vue. Plain function elements are the base; JSX stays optional.
2. **On-screen preview matters.** Both apps show the document on screen first, readable on a phone. The display list gets a second backend (SVG) so the same definition previews without a PDF viewer.
3. **Print features move early.** Certificates, bibs and labels go to a print shop: CMYK, bleed, trim marks and PDF/X-4.
4. **Fit-to-width text** becomes a v1 text feature (certificate names, bib numerals).
5. **Repeated-layout batches** become a benchmark: 5,000 bibs in one file, with fonts and shared graphics embedded once.
6. **Vector QR codes** move from "advanced" to the first release.
7. **Grid placement in millimetres** (label sheets) needs an explicit `Grid` element, not only flex.
8. **Per-tenant theming** confirms the theme design: one document definition, many brands.
9. **English and Indonesian only** for now: simple-script shaping is enough; hyphenation patterns for both languages ship first.

## Acceptance documents

Three documents are rebuilt in mbingpdf and compared with the current printed output. Each gates a milestone.

| Document | Proves | Gates |
| --- | --- | --- |
| Invoice | Tables, totals, theming, footers | M3 |
| Finisher certificate | Full-bleed design, fit text, vector art, CMYK and bleed | M3 |
| Rental agreement with inspection report | Long text pagination, keep-together, photo grid, signatures | M4 |
