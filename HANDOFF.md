# HANDOFF — mbingpdf
_Updated: 2026-11-11 04:40 WIB · Session 2 · Milestone: M0–M3 done; M4 and M5 done except the owner's steps · Branch: main_

## Where we are
M0, M1, M2 and M3 are finished. The root `mbingpdf` entry now has
the document API: `Document`, `Page`, `Stack`, `Row`, `Box`, `Text`, `Span`, `Link`, `Image`, `Grid`,
`Spacer`, `Absolute`, `Canvas`, `PageBreak` and `render()`. Underneath are `mbingpdf/core` (PDF writer),
`mbingpdf/font` (TrueType, CFF, WOFF2, shaping, variable fonts), `mbingpdf/text` (line breaking, hyphenation,
paragraphs) and `mbingpdf/image` (JPEG, PNG). Output is byte-identical on Node, Bun, Deno and Chromium.
Nothing is published to npm.

## Done this session
- Toolchain: pnpm workspace, TypeScript 7 strict + `isolatedDeclarations`, tsdown (ESM + CJS), Vitest, Biome,
  Changesets, GitHub Actions.
- Writer (`packages/mbingpdf/src/core/`): `objects.ts`, `serialize.ts`, `writer.ts` (xref streams + object
  streams, or classic table), `document.ts`, `hash.ts` (file ID), `bytes.ts`.
- Pages and drawing: `page.ts`, `content.ts`, `color.ts`, `units.ts`.
- Standard fonts: `standard-font.ts`, `standard-fonts.ts`, generated `standard-font-data.ts`.
- Test harness (`packages/mbingpdf/test/harness/`): samples, pdf.js + PDFium rendering, golden images,
  digests, runtime scripts for Node/Bun/Deno/Chromium.

## In progress (not finished)
M1 has just started; see `docs/05-roadmap.md`.

## Next steps (in order)
1. ~~TrueType parsing and embedding as a CID font with `ToUnicode`~~ done (`src/font/`, `src/core/embedded-font.ts`).
2. ~~Glyph subsetting for TrueType outlines~~ done.
3. ~~OpenType/CFF embedding and subsetting~~ done (`src/font/cff.ts`); the class is now `Font`, not
   `TrueTypeFont`.
4. ~~Shaping for simple scripts~~ done (`src/font/shaper.ts`, `src/font/layout/`); output equals HarfBuzz on the
   test corpus. Not covered: GSUB type 8, GPOS cursive, device/variation deltas, fallback mark placement.
5. ~~Variable-font instancing~~ done (`font.instance({ wght: 700 })` or `font.instance("Bold")`;
   `src/font/variations.ts`, `gvar.ts`, `glyf.ts`). Instances are written unhinted (no `cvar` support).
6. ~~WOFF2 decoding~~ done (`src/font/woff2.ts`, `loadFont()`); Brotli comes from the runtime (row 24).
7. ~~Line breaking, justification, fit-to-width, hyphenation, fallback~~ done (`src/text/`, exported as
   `mbingpdf/text`): `layoutParagraph`, `drawParagraph`, `fitText`, `lineBreaks`, `graphemes`,
   `hyphenateEnglish`, `hyphenateIndonesian`.
8. ~~M1 exit test, automated half~~ done: subsets within 10% of `hb-subset`. The Acrobat copy check is manual
   and still open; text extraction is checked with pdf.js meanwhile.
9. ~~M2 layout engine~~ done (`src/layout/`, exported from the root `mbingpdf` entry): elements, flex,
   fragmentation, headers/footers, `render()`. Images are in `src/image/` (`mbingpdf/image`).
10. ~~M2 leftovers~~ done: `mbingpdf/svg` (`renderSvg`), Web Worker check in `test/harness/browser.mjs`.
11. M3 done so far: tables (`src/layout/table.ts`), lists, `fit` on Text, QR codes (`src/qr/`), print
    (bleed, marks, spot colours, output intent, PDF/X-4, XMP, DPI warnings). Samples `invoice` and
    `certificate` are the two M3 acceptance documents.
12. Also done in M3: `Heading` with bookmarks, `id` + `Link({ to })`, `TableOfContents`, `Columns`, and the
    5,000-bib benchmark (now a test). Themes (`src/layout/theme.ts`) and SVG input (`src/layout/svg-input.ts`, the `Svg` element) are done.
    M3 is closed; deferred to M4:
    shared graphics (Form XObjects; less urgent now that batches are fast and small).
13. M4 done so far: JSX runtime (`src/jsx-runtime.ts`), `inspect()`, warning paths, `strict`, `debug`.
14. Also done in M4: the `agreement` sample (third acceptance document); starter templates in `examples/`
    with a test; `docs/guide/quick-start.md` and `docs/guide/elements.md`; `pnpm size` with
    `size-budget.json`, run in CI.
15. Release preparation is done: `packages/mbingpdf/README.md` and `LICENSE`, package metadata with
    `types` conditions and provenance, `.changeset/first-release.md`, `.github/workflows/release.yml`
    (manual, dry run by default). To release: `pnpm changeset version`, commit, then run the workflow with
    dry-run off. Nothing has been published.
16. Also done in M4: `@mbingpdf/react` and `@mbingpdf/vue` (`packages/react`, `packages/vue`): `PdfPreview`,
    `usePdf`, `downloadPdf`, built on `previewPages()` in `mbingpdf/svg`. Tested with happy-dom; the Vue one
    was also checked by hand in Chromium.
17. Also done in M4: `@mbingpdf/dev` (`packages/dev`): the `mbingpdf` command (`dev <file>` preview server
    with redraw on save, outlines, warnings; `build <file>`), `loadDocument`, `startPreview`. Every example
    has a default export, so `pnpm --filter mbingpdf-examples dev invoice.ts` works after a
    build.
18. Also done in M4: shared graphics. An `Svg` becomes a Form XObject (`PdfDocument.createForm`,
    `ContentStream.form`, the `shared` display item), stored once per file per source and colour.
19. Also done in M4: benchmarks (`benchmarks/run.mjs`, results in `docs/benchmarks.md`). mbingpdf is
    fastest on the invoice and smallest everywhere; pdfmake is about twice as fast on a 2,000-row table and
    PDFKit on plain paragraphs. Speeding up long tables is the open follow-up.
20. M4 has nothing left that can be done without the owner (see below).
21. M5 is done except Acrobat's accessibility checker by hand:
    - `conformance` takes a list; PDF/A-2b/2u/2a and 3b/3u/3a (`src/core/document.ts`, built-in sRGB in
      `src/core/srgb.ts`);
    - tagged PDF (`tagged: true`) and PDF/UA-1: `src/core/structure.ts`, tags set in `layout/engine.ts`
      (`tagOf`) and `layout/table.ts`, wrapped in `layout/paint.ts`, written in `layout/pdf.ts` (`Marker`);
      new element properties `alt`, `decorative`, `role`;
    - attachments and `facturX()` (`Document({ attachments, metadata })`, `src/layout/factur-x.ts`);
    - AES-256 encryption (`render(doc, { encryption })`; `src/core/crypto.ts`, `src/core/encryption.ts`);
    - veraPDF validates the samples at every level in `test/conformance.test.ts` (Docker image
      `verapdf/cli` or a local `verapdf`; required on the Node 24 CI job).
22. Next: M6 in `docs/05-roadmap.md`, ordered by demand. Open follow-ups: long-table speed; a hyphen added
    by hyphenation is read as a real hyphen in tagged files; tagged output and encryption are not in the
    benchmarks.

## Waiting on the owner
The owner asked for autonomous work: decide, commit and push without asking, and report afterwards. Three
things do need them, all part of the M4 exit:
- publishing `0.1.0` to npm: create the `@mbingpdf` organisation on npm (for the scoped packages), add the
  `NPM_TOKEN` secret, run `pnpm changeset version`, commit, then start
  the Release workflow with dry-run off (their account and their decision);
- switching one document type in each of the two private apps to mbingpdf;
- the manual checks: Acrobat PDF/X-4 preflight of the certificate, copying text out of Acrobat, comparing
  the acceptance documents with the current printed versions, and (M5) Acrobat's accessibility checker on a
  file rendered with `conformance: "PDF/UA-1"`.

## Decisions this session
- Row 14: fflate, pinned and compiled into the build; zero runtime dependencies.
- `mbingpdf/core` uses PDF-native coordinates (origin bottom-left, y up). The top-left flip belongs to the
  layer that paints the display list.
- Text a standard font cannot encode throws instead of being replaced.
- Standard-font kerning pairs are not bundled (size); real kerning arrives with embedded fonts in M1.
- Rows 16–23 in `docs/07-open-decisions.md` (shaping oracle, own UAX #14/#29, hyphenation licensing, greedy
  line filling).

## Health
- Git: clean after this commit, pushed to origin/main.
- Checks: lint, typecheck, build, size and 491 tests green, except that the two speed assertions (5,000
  bibs under 60 s, 1,000 rows under 5 s) failed on this laptop while another project was loading it; old and
  new code timed the same side by side, and CI passes them. Runtime digests match on Node, Deno, Chromium
  and in a Web Worker (10 samples).
- Published: not published.

## Gotchas / don't redo
- The repo is public; the two reference apps are private. Keep their details generic in committed files.
- Do not use Yoga for layout: it cannot split a box across pages (see `docs/03-architecture.md`).
- `changeset init` is interactive-only in v3; the config was written by hand.
- pdf.js in Node needs `standardFontDataUrl` as a file-system path, not a `file:` URL; with a URL it silently
  falls back to system fonts.
- Node's `Buffer.slice()` returns a view, not a copy. Font input is re-wrapped in `parseSfnt`; in tests read
  fonts with `readFont()` from `test/harness/env.ts`.
- An object is serialised when it is set on the writer and cannot change afterwards; allocate a ref first for
  anything that must be completed later.
- Regenerating data: `scripts/generate-*.mjs` (standard fonts, Unicode tables, en-US hyphenation); inputs are
  not in the repo, the scripts' headers say where to get them.
- pdf.js reports wide letter spacing as spaces between letters when extracting text.
- Run checks as their own step and commit only when they pass; do not chain a commit after a piped check
  (a failing test was pushed once that way and fixed in the next commit).
- After an intended output change: review `test/.artifacts/`, then `pnpm test:update`.
- `UPDATE_GOLDEN=1` rewrites a few unrelated PNGs (certificate, tour) with invisible differences; restore
  them with `git checkout` and keep only the files you meant to change.
- veraPDF through Docker takes about 10 s per run; `validate(files, "auto")` checks every PDF/A level in one
  run by letting each file's own metadata pick the level.
- pdf.js drops the spaces at line ends when asked for the text of a tagged element; poppler
  (`pdfinfo -struct-text`) shows them.
- Toolchain on this machine: Node 26, pnpm 10, Deno 2, system Chromium, qpdf, poppler. No Bun (CI covers it).

## Resume checklist
1. Read this file, then M1 in `docs/05-roadmap.md`.
2. `git status` / `git log -5` — confirm it matches "Health" above.
3. `pnpm install && pnpm check`.
4. Start "Next steps" #1.
