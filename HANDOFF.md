# HANDOFF — mbingpdf
_Updated: 2026-11-10 14:20 WIB · Session 2 · Milestone: M0, M1 and M2 done; M3 (Tables, vector art and print) next · Branch: main_

## Where we are
M0, M1 and M2 are finished. The root `mbingpdf` entry now has
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
11. Then M3: tables, lists, multi-column, outlines, SVG input, QR codes, themes, print marks, PDF/X-4.

## Waiting on the owner
None. The owner asked for autonomous work: decide, commit and push without asking, and report afterwards.

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
- Checks: `pnpm check` green (lint, typecheck, 290 tests, build). Runtime digests match on Node, Deno, Chromium
  and in a Web Worker.
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
- After an intended output change: review `test/.artifacts/`, then `pnpm test:update`.
- Toolchain on this machine: Node 26, pnpm 10, Deno 2, system Chromium, qpdf, poppler. No Bun (CI covers it).

## Resume checklist
1. Read this file, then M1 in `docs/05-roadmap.md`.
2. `git status` / `git log -5` — confirm it matches "Health" above.
3. `pnpm install && pnpm check`.
4. Start "Next steps" #1.
