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

## Assumed until someone objects

| # | Decision | Assumption |
| --- | --- | --- |
| 8 | Licence | MIT |
| 9 | Authoring style | Function elements as the base, JSX as optional sugar over the same data |
| 10 | HTML input | Out of scope, except a small rich-text subset after 1.0 |
| 11 | Dependencies | Zero runtime dependencies in the core where practical; deflate is the one likely exception |
| 12 | Module format | Ship both ESM and CJS |

## Still open

1. **Is PDF/A or accessibility legally required for any document?** If yes, tagging is designed into M2 instead of added in M5.
2. **Which print shop profile?** A printer usually names the ICC profile it wants (for example FOGRA39 or a local equivalent). We need one real target to test PDF/X-4 output against.
3. **Which fonts do the brands use?** Their licences decide whether we can keep them in the test corpus.
