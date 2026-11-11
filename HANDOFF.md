# HANDOFF — mbingpdf
_Updated: 2026-11-11 13:30 WIB · Session 3 · Milestone: M6 Advanced (M0–M5 done but for manual checks) · Branch: main_

## Where we are
mbingpdf 0.1.0 is on npm (`mbingpdf`, `@mbingpdf/react`, `@mbingpdf/vue`, `@mbingpdf/dev`) and the website is
live at https://mbingpdf.enterbiner.com (home, playground, documentation). The running-event app has moved
its documents to the library; the rental app has not yet. M6 has started with barcodes and charts.

## Done this session
- M5: PDF/A-2 and A-3 (b, u, a), tagged PDF and PDF/UA-1, attachments and `facturX()`, AES-256 encryption
  (`src/core/structure.ts`, `srgb.ts`, `crypto.ts`, `encryption.ts`; tags in `src/layout/`). veraPDF in tests.
- M6 start: `mbingpdf/barcode`, `Barcode`, `BarChart`, `LineChart`, `PieChart`, text on `Canvas`
  (`src/barcode/`, `src/layout/barcode.ts`, `charts.ts`, `canvas.ts`).
- First adoption by the running-event app, two rounds of notes, fixed: `justify`, growing `Spacer()`,
  `truncate`, `width: "auto"`, dashed borders, `Svg` cover and `monochrome`, `loadImage()`, lazy `usePdf`,
  preview labels and text, fixed-height stacks no longer split. Guide: `docs/guide/adopting.md`.
- Release 0.1.0 (tag `v0.1.0`), published by the owner through the Release workflow.
- Website in `site/` (generator `site/build/generate.ts`, templates `site/templates/*.js`), deployed by
  `.github/workflows/site.yml`; DNS and HTTPS set up.

## In progress (not finished)
Nothing half-done. `.changeset/website.md` is waiting for the next release (package home page).

## Next steps (in order)
1. Ask the owner for the running-event app's report after it switched from vendored files to npm 0.1.0
   (it should confirm round-2 notes A and C are gone), and fix anything it found.
2. Help move one document of the rental app (React) with `docs/guide/adopting.md`; collect its notes.
3. Before the next release, set up npm trusted publishing: the owner adds a trusted publisher per package
   on npmjs.com (user `navis23`, repository `mbingpdf-engine`, workflow `release.yml`, allow `npm publish`);
   change `release.yml` to publish with npm 11.5.1+ and no token. A new setting expires after 2 days
   without a publish, so do both together. Then `pnpm changeset version` and release 0.1.1.
4. Open follow-ups, by demand: WebP on servers; WOFF2 in browsers (needs a Brotli decoder, ~50 kB);
   `maxLines`; long-table speed (half of pdfmake's); crop marks in the SVG preview; a hyphen added by
   hyphenation is read as a real hyphen in tagged files; GS1-128, Data Matrix, PDF417.
5. Rest of M6 in `docs/05-roadmap.md`, in the order the owner asks: forms, signatures, complex scripts,
   reading PDFs, HTML subset.

## Waiting on the owner
- The running-event app's report on 0.1.0; choosing the rental app's first document.
- Manual checks with Acrobat: PDF/X-4 preflight, copying text, the accessibility checker on a PDF/UA file.
- Which M6 item comes next.

## Decisions this session
- Standards, tagging, attachments, encryption → rows 66–74 in docs/07-open-decisions.md
- Canvas text, barcodes, charts → rows 75–77
- First adoption and what came of it → rows 78–84
- Website → row 85

## Health
- Git: clean · last commit 712a23e Record that the website is live · in sync with origin
- Checks: typecheck pass · lint pass (5 old warnings) · build pass · size pass · tests 565 of 566: the
  5,000-bib speed limit (60 s) failed at 85 s while another project was loading this laptop; it passes
  when the machine is idle and in CI (last CI run green)
- Published: 0.1.0 on npm, with provenance

## Gotchas / don't redo
- The repo is public; the two apps are private. Keep their details generic in committed files.
- Run `vitest` from the repository root; from `packages/mbingpdf` the examples load a second copy of the
  library and fonts fail with "undefined does not permit embedding".
- Run checks as their own step before committing; look at CI before the next push.
- CI's gzip measures about 1 kB more than this machine's: leave size budgets a few kB of room.
- `UPDATE_GOLDEN=1` also rewrites certificate and tour PNGs with invisible differences: `git checkout` them.
- CI type-checks before it builds: nothing may depend on `dist/` existing (the site maps to source).
- npm: publishing needs a granular token with "bypass 2FA" ticked, in the `NPM_TOKEN` secret, until
  trusted publishing replaces it. A version number can never be reused.
- GitHub Pages only checks DNS when the custom domain is saved: if no certificate comes, clear the domain
  and set it again.
- Chart colours and anything from the theme must be resolved inside `draw`, not when the element is made.
- Site templates and playground code run inside a block, so they may declare `const spot` or `const rgb`.
- Barcode reference patterns typed from memory were wrong twice; the scanners (zbar, ZXing) are the judge.
- veraPDF runs from Docker image `verapdf/cli` (about 10 s a run); `validate(files, "auto")` covers every
  PDF/A level at once.
- Do not use Yoga for layout; do not bundle a Brotli decoder without a decision (row 79).
- Toolchain here: Node 26, pnpm 10, Deno 2, system Chromium, qpdf, poppler, zbar, ZXing, Docker. No Bun.

## Resume checklist
1. Read this file, then `CLAUDE.md` if it exists, then M6 in `docs/05-roadmap.md`.
2. `git status` / `git log -5` — confirm it matches "Health" above.
3. Start "Next steps" #1.
