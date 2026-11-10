# HANDOFF — mbingpdf
_Updated: 2026-11-10 10:20 WIB · Session 2 · Milestone: M0 done, M1 (Fonts and text) starting · Branch: main_

## Where we are
M0 is finished and green in CI. `mbingpdf/core` writes valid multi-page PDFs with vector graphics, RGB/CMYK
colour, opacity, print boxes and text in the 14 standard fonts, with byte-identical output on Node, Bun, Deno
and Chromium. Nothing is published to npm. The root `mbingpdf` entry is still empty.

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
3. OpenType/CFF embedding and subsetting.
4. ~~Shaping for simple scripts~~ done (`src/font/shaper.ts`, `src/font/layout/`); output equals HarfBuzz on the
   test corpus. Not covered: GSUB type 8, GPOS cursive, device/variation deltas, fallback mark placement.
5. ~~Variable-font instancing~~ done (`font.instance({ wght: 700 })` or `font.instance("Bold")`;
   `src/font/variations.ts`, `gvar.ts`, `glyf.ts`). Instances are written unhinted (no `cvar` support).
6. WOFF2 decoding (needs a Brotli decoder; decide how before starting).
7. Line breaking (UAX #14), justification, fit-to-width, hyphenation for English and Indonesian, fallback.

## Waiting on the owner
None. The owner asked for autonomous work: decide, commit and push without asking, and report afterwards.

## Decisions this session
- Row 14: fflate, pinned and compiled into the build; zero runtime dependencies.
- `mbingpdf/core` uses PDF-native coordinates (origin bottom-left, y up). The top-left flip belongs to the
  layer that paints the display list.
- Text a standard font cannot encode throws instead of being replaced.
- Standard-font kerning pairs are not bundled (size); real kerning arrives with embedded fonts in M1.

## Health
- Git: clean after this commit, pushed to origin/main.
- Checks: `pnpm check` green (lint, typecheck, 82 tests, build). CI green on all jobs.
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
- After an intended output change: review `test/.artifacts/`, then `pnpm test:update`.
- Toolchain on this machine: Node 26, pnpm 10, Deno 2, system Chromium, qpdf, poppler. No Bun (CI covers it).

## Resume checklist
1. Read this file, then M1 in `docs/05-roadmap.md`.
2. `git status` / `git log -5` — confirm it matches "Health" above.
3. `pnpm install && pnpm check`.
4. Start "Next steps" #1.
