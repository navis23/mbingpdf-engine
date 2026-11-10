# 07 — Decisions

## Decided

| # | Decision | Answer | Date |
| --- | --- | --- | --- |
| 1 | Name | `mbingpdf`. Repository: `navis23/mbingpdf-engine`. The npm names `mbingpdf` and `@mbingpdf/*` were unclaimed on 2026-11-10 | 2026-11-10 |
| 2 | Open source | Public from the first commit | 2026-11-10 |
| 3 | Scope of v1 | Generating PDFs only. Reading and editing existing files comes after 1.0 | 2026-11-10 |
| 4 | First documents | Invoices, reports, certificates; full list in [08-target-documents.md](./08-target-documents.md) | 2026-11-10 |
| 5 | Languages | English and Indonesian. Latin-script shaping only in v1; complex scripts stay an optional later package | 2026-11-10 |
| 6 | Commercial print | In scope. CMYK, bleed, trim marks and PDF/X-4 are part of the first release | 2026-11-10 |
| 7 | Runtime | Browser and server both first-class; see "Where rendering runs" in [03-architecture.md](./03-architecture.md) | 2026-11-10 |

| 8 | PDF/A and accessibility | Not treated as a legal requirement for our documents. Tagged PDF, PDF/UA and PDF/A stay in M5. Elements carry their semantic role (heading, table header, list item) from M2, so tagging is added later without changing the API | 2026-11-10 |
| 9 | Print colour target | Default output is sRGB, which digital print shops accept. CMYK is opt-in per document. The reference profile for testing PDF/X-4 is Coated FOGRA39 (ISO Coated v2). Profiles are passed in as bytes and never bundled in the core package | 2026-11-10 |
| 10 | Test fonts | Plus Jakarta Sans, JetBrains Mono, Inter and Barlow Condensed — the four families our apps already use. All are under the SIL Open Font License, so they can sit in the public test corpus. Two ship as variable fonts, so variable-font instancing is required in M1, not optional | 2026-11-10 |

Decisions 8–10 were delegated to the plan's author and can be revisited: 8 if a customer or regulator asks for archival or accessible files, 9 when a print shop names a different profile.

## Assumed until someone objects

| # | Decision | Assumption |
| --- | --- | --- |
| 11 | Licence | MIT |
| 12 | Authoring style | Function elements as the base, JSX as optional sugar over the same data |
| 13 | HTML input | Out of scope, except a small rich-text subset after 1.0 |
| 14 | Dependencies | Zero runtime dependencies in the core where practical; deflate is the one likely exception |
| 15 | Module format | Ship both ESM and CJS |
