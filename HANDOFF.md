# HANDOFF — mbingpdf
_Updated: 2026-11-11 15:57 WIB · Session 4 · Milestone: M6 Advanced (M0–M5 done but for manual checks) · Branch: main_

## Where we are
mbingpdf 0.2.0 and `@mbingpdf/react`, `@mbingpdf/vue`, `@mbingpdf/dev` 0.1.1 are on npm (tag `v0.2.0`), published
through npm trusted publishing with provenance. The website is live at https://mbingpdf.enterbiner.com. The
running-event app uses the library (on 0.1.0) and has been told how to move to 0.2.0; the rental app has not
started. M6 goes on by demand.

## Done this session
- WebP decoder of our own: `src/webp/` (`lossless.ts`, `lossy.ts`, `tables.ts`, `index.ts`), entry `mbingpdf/webp`
  (`decodeWebp`). `loadImage` reads WebP on every runtime through a dynamic import. Exact to libwebp: fixtures and
  `make.sh` in `test/images/webp/`, `test/webp.test.ts`, and the cross-runtime harness (`test/harness/digest.ts`,
  `runtime.mjs`, `browser*.ts|mjs`).
- A hyphen added by hyphenation stands for U+00AD (`src/layout/paint.ts`); test in `test/tagged.test.ts`.
- Round-4 answer written into the running-event app's own notes file (uncommitted there, by design).
- Release 0.2.0: `.github/workflows/release.yml` publishes tarballs with npm 11.5.1+ over OIDC, no token.
- Site: hero without chips, smaller headline on desktop (`site/build/pages.ts`, `site/src/styles.css`).

## In progress (not finished)
Nothing half-done.

## Next steps (in order)
1. When the owner says the running-event app has adopted 0.2.0, read its "Round 5" notes in its mbingpdf notes
   file and fix what they find (the owner gave its agent a prompt to upgrade, test before/after and report).
2. Help move one document of the rental app (React) with `docs/guide/adopting.md`; suggested first document: the
   receipt. Collect its notes the same way.
3. Rest of M6 in `docs/05-roadmap.md` in the order the owner asks; recommended next: interactive forms (AcroForm).
4. Follow-ups only on demand: `maxLines`; long-table speed (half of pdfmake's); crop marks in the SVG preview;
   GS1-128, Data Matrix, PDF417; WOFF2 in browsers (Brotli decoder, needs a decision, row 79).
5. To release again: `pnpm changeset` per change, `pnpm changeset version`, commit, then the owner runs
   Actions → Release (untick dry-run); afterwards tag `v<version>` on that commit.

## Waiting on the owner
- The running-event app's round-5 report on 0.2.0.
- Choosing the rental app's first document (suggested: the receipt).
- Which M6 item comes next (suggested: forms).
- Manual checks with Acrobat: PDF/X-4 preflight, copying text, the accessibility checker on a PDF/UA file.

## Decisions this session
- WebP decoder of our own → row 86 · soft hyphen at line breaks → row 87
- Trusted publishing, no token → row 88 · home page hero → row 89

## Health
- Git: clean · last commit 5b380d4 Release: log in to npm through OIDC only (before this record) · in sync
- Checks: typecheck pass · lint pass (5 old warnings) · build pass · size pass · tests 601 of 601 pass
- Published: mbingpdf 0.2.0; @mbingpdf/react, /vue, /dev 0.1.1 — all with provenance

## Gotchas / don't redo
- The repo is public; the two apps are private. Keep their details generic in committed files.
- Run `vitest` from the repository root; from `packages/mbingpdf` fonts fail ("undefined does not permit embedding").
- Run checks as their own step before committing; look at CI before the next push.
- CI's gzip measures about 1 kB more than this machine's: leave size budgets a few kB of room.
- `UPDATE_GOLDEN=1` also rewrites certificate and tour PNGs with invisible differences: `git checkout` them.
- CI type-checks before it builds: nothing may depend on `dist/` existing (the site maps to source).
- Release: never give `actions/setup-node` a `registry-url` (placeholder token blocks OIDC). "OIDC token exchange
  error - package not found" means the package's trusted publisher is missing or unsaved on npmjs.com.
- On 0.x a caret range does not cross minors: apps on `^0.1.0` must change to `^0.2.0` themselves.
- WebP: compare against libwebp (ImageMagick here has libwebp 1.6.0); VP8 tables came out of the installed
  `libwebpdecoder.so`, never type them. Lossless pixels are `Int32Array` (a `Uint32Array` was 2× slower).
- `pkill -f <pattern>` in a Bash call can match its own shell and kill it.
- Chart colours and anything from the theme must be resolved inside `draw`, not when the element is made.
- Barcode reference patterns typed from memory were wrong twice; the scanners (zbar, ZXing) are the judge.
- veraPDF runs from Docker image `verapdf/cli`; `validate(files, "auto")` covers every PDF/A level at once.
- Do not use Yoga for layout; do not bundle a Brotli decoder without a decision (row 79).
- Toolchain here: Node 26, pnpm 10, Deno 2, system Chromium, qpdf, poppler, zbar, ZXing, Docker, ImageMagick.
  No Bun (CI covers it).

## Resume checklist
1. Read this file, then `CLAUDE.md` if it exists, then M6 in `docs/05-roadmap.md`.
2. `git status` / `git log -5` — confirm it matches "Health" above.
3. Start "Next steps" #1.
