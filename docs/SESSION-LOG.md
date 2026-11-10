# Session log

Append-only. One short entry per working session; newest at the bottom.

## Session 1 — 2026-11-10
- Goal: agree the plan and strategy before writing code.
- Done: surveyed existing JS PDF libraries; wrote the plan (`docs/01`–`08`); reviewed the documents our two apps
  produce (both use browser print, no PDF library) and folded their needs into the plan; named the project
  mbingpdf and published the repo; added `wrap-up` and `resume` skills.
- Decisions: rows 1–10 in 07-open-decisions.md.
- Next: M0 — scaffold the pnpm workspace and toolchain.

## Session 2 — 2026-11-10
- Goal: start building; the owner asked for continuous autonomous work.
- Done: M0 (toolchain, PDF writer, pages and drawing, standard fonts, test harness with pdf.js and PDFium
  goldens, cross-runtime digests on Node, Bun, Deno, Chromium and a Web Worker). M1 (TrueType, CFF and WOFF2
  fonts; subsetting; shaping checked against HarfBuzz; variable-font instancing; UAX #14 line breaking and
  UAX #29 graphemes passing the Unicode conformance files; hyphenation; paragraph layout). M2 (the document
  API and layout engine with pagination; JPEG and PNG; SVG preview backend). M3 (tables, lists, columns,
  headings and bookmarks, table of contents, QR codes, SVG input, themes, print output with PDF/X-4). M4
  started (JSX, `inspect()`, diagnostics).
- Decisions: rows 14 and 16–54 in 07-open-decisions.md.
- Mistake to learn from: one commit was pushed with a failing test because the commit was chained after a
  piped check; fixed in the next commit. Checks now run as their own step.
- Next: the rest of M4 (see HANDOFF.md). Publishing and the app switch-over wait for the owner.
- Later in the session: M4 finished apart from the owner's steps. Added `@mbingpdf/react`, `@mbingpdf/vue`
  (preview components), `@mbingpdf/dev` (the `mbingpdf dev` preview server and `mbingpdf build`), shared
  graphics (an `Svg` is stored once per file), and benchmarks (`docs/benchmarks.md`). Decisions: rows 55–65.
- Next: the owner publishes 0.1.0 (needs the `@mbingpdf` npm organisation and `NPM_TOKEN`) and switches one
  document in each app; then M5.
