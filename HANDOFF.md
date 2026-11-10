# HANDOFF — mbingpdf
_Updated: 2026-11-10 09:41 WIB · Session 1 · Milestone: planning done, M0 (Foundations) not started · Branch: main_

## Where we are
The plan is written and agreed; there is no code yet. mbingpdf is a pure-TypeScript PDF generation library
(writer, font and text engine, pagination-aware layout engine, typed declarative API) for browsers and servers.
The repo is public at https://github.com/navis23/mbingpdf-engine and holds only docs, licence and these skills.

## Done this session
- Landscape survey of JS PDF libraries → `docs/01-landscape.md`.
- Plan: vision, architecture, API design, roadmap, quality strategy → `docs/02`–`06`.
- Reviewed the documents our two apps produce (both use `window.print()`, no PDF library) →
  `docs/08-target-documents.md`, with three acceptance documents that gate M3 and M4.
- Decisions 1–10 recorded → `docs/07-open-decisions.md`.
- Local folder renamed to `~/Dev/mbingpdf`. `wrap-up` and `resume` skills added under `.claude/skills/`.

## In progress (not finished)
Nothing half-done.

## Next steps (in order)
1. Scaffold M0 tooling: pnpm workspace, TypeScript strict, tsdown (ESM + CJS), Vitest, Biome, Changesets,
   `package.json` for `mbingpdf` with subpath exports (`.`, `./core`). Node floor 22.
2. CI (GitHub Actions): typecheck, lint, test on Node; add Bun, Deno and headless-browser runs once tests exist.
3. PDF writer in `src/core/`: object model (dict, array, name, string, stream, ref), serialiser with xref
   streams, deflate (choose fflate vs own — decision row 14), document metadata, deterministic mode.
4. Pages and content streams: paths, fill, stroke, transforms, clipping, opacity, RGB and CMYK,
   MediaBox/TrimBox/BleedBox.
5. Text with the 14 standard fonts (bundled metrics).
6. Test harness: `qpdf --check` on every sample, render-to-PNG diff with pdf.js and PDFium.
   M0 exit test is in `docs/05-roadmap.md`.

## Waiting on the owner
None. All open questions were decided (rows 8–10 were delegated and can be revisited).

## Decisions this session
- Name mbingpdf, public repo, generation only in v1, English and Indonesian, commercial print in scope,
  browser and server both first-class → rows 1–7.
- PDF/A and accessibility at M5; sRGB default with FOGRA39 as the CMYK test profile; four OFL test fonts
  (two variable, so variable-font instancing is required in M1) → rows 8–10.

## Health
- Git: see `git status` · last pushed commit 838245f; the wrap-up commit after it is local only
- Checks: typecheck n.a. · tests n.a. · lint n.a. · build n.a. (no code yet)
- Published: not published. npm names `mbingpdf` and `@mbingpdf/*` were unclaimed on 2026-11-10.

## Gotchas / don't redo
- The repo is public; the two reference apps are private. Keep their details generic in committed files.
- Do not use Yoga for layout: it cannot split a box across pages (see `docs/03-architecture.md`).
- `CompressionStream` is async and runtime-dependent, which breaks byte-identical output; use a bundled
  synchronous deflate.
- Some landscape claims about @react-pdf/renderer are marked *(verify)*; recheck before quoting publicly.
- Toolchain on this machine: Node 26, pnpm 10, no Bun installed.

## Resume checklist
1. Read this file, then `CLAUDE.md` if it exists, then M0 in `docs/05-roadmap.md`.
2. `git status` / `git log -5` — confirm it matches "Health" above.
3. Start "Next steps" #1.
