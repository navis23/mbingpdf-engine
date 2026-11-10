---
name: wrap-up
description: End-of-session wrap-up for mbingpdf. Rewrites HANDOFF.md, updates the roadmap status, appends to the session log and decisions doc, and commits the record so the next session can resume cold. Use when the user says "wrap up", "wrap-up", "end session", "handoff", "save progress", "we're switching session", or before a /clear.
---

# Wrap-up — close the session so the next one can resume cold

Goal: a brand-new session that reads only `HANDOFF.md` (plus the files it links) knows exactly
where we are and what to do next, in under 2 minutes. Plain language, no private shorthand.

## Steps

1. **Gather facts (don't guess).** Run in parallel:
   - `date '+%Y-%m-%d %H:%M %Z'`
   - `git status --short`, `git log --oneline -15`, `git status -sb` (ahead/behind origin)
   - `git diff --stat HEAD` (uncommitted work)
   - Read current `HANDOFF.md`, `docs/05-roadmap.md`, the tail of `docs/SESSION-LOG.md`.
   - If `package.json` exists: run whichever of `pnpm typecheck`, `pnpm test --run`, `pnpm lint`,
     `pnpm build` are defined. Record pass/fail honestly; never claim green without running.

2. **Work out the session number.** Last `## Session N` in `docs/SESSION-LOG.md` + 1.

3. **Rewrite `HANDOFF.md` completely** (it is a snapshot, not a log) using exactly this template.
   Hard limit: **80 lines**. Every "Next step" must be concrete enough to start without asking.

   ```markdown
   # HANDOFF — mbingpdf
   _Updated: <date time> · Session <N> · Milestone: <M-number and name> · Branch: <branch>_

   ## Where we are
   <2–4 sentences: what exists and works now, which milestone we're in.>

   ## Done this session
   - <outcome, with file paths>

   ## In progress (not finished)
   - <item> — state: <what's done, what's left> — files: <paths>
   (write "Nothing half-done." if clean)

   ## Next steps (in order)
   1. <first concrete action — file/command>
   2. ...

   ## Waiting on the owner
   - <question/decision needed from the user> (or "None.")

   ## Decisions this session
   - <decision> → row <n> in docs/07-open-decisions.md

   ## Health
   - Git: <clean / N uncommitted files> · last commit <hash> <msg> · <in sync / N ahead of origin>
   - Checks: typecheck <pass/fail/n.a.> · tests <pass/fail/n.a.> · lint <…> · build <…>
   - Published: <npm version, or "not published">

   ## Gotchas / don't redo
   - <things learned the hard way, dead ends, traps>

   ## Resume checklist
   1. Read this file, then `CLAUDE.md` if it exists, then the current milestone in `docs/05-roadmap.md`.
   2. `git status` / `git log -5` — confirm it matches "Health" above.
   3. Start "Next steps" #1.
   ```

4. **Update `docs/05-roadmap.md`** — keep one `_Status: not started | in progress | done (<date>)_`
   line directly under each milestone heading, and tick or add `- [x]` / `- [ ]` on the bullets of
   the current milestone. Add newly discovered tasks under the right milestone. Don't rewrite the
   plan; only change status and append.

5. **Append to `docs/SESSION-LOG.md`** (append-only, ≤12 lines per entry):

   ```markdown
   ## Session <N> — <date>
   - Goal: <one line>
   - Done: <bullets, outcomes not activity>
   - Decisions: rows <n>, ... in 07-open-decisions.md
   - Next: <first next step>
   ```

6. **Record new decisions in `docs/07-open-decisions.md`** — one new row in the "Decided" table per
   decision the user made or approved, with the date. Never rewrite an old row's answer; add a new
   row that says "Supersedes <n>". If a design doc (02–04, 06, 08) is now wrong, fix it in the same
   commit.

7. **Save durable feedback to memory** only if the user corrected how we work (not project facts —
   those live in the docs).

8. **Commit the record.** Stage explicit paths only (never `git add -A` / `git add .`):
   `git add HANDOFF.md docs/05-roadmap.md docs/SESSION-LOG.md docs/07-open-decisions.md` (+ any docs
   touched). If there is uncommitted *code*, ask the user whether to commit it, leave it (and say so
   in "In progress"), or stash it. Commit message: `docs(wrap-up): session <N> — <summary>`.
   Do not push unless the user asks.

9. **Report to the user** in ≤10 lines: session number, what's recorded, the first next step,
   anything waiting on them, whether there are unpushed commits, and that a new session can start
   with `/resume`.

## Rules
- Facts only from commands you ran; if a check wasn't run, write "not run".
- **This repository is public.** Never put secrets, tokens or personal details in any committed file.
  The two apps the library is designed against are private: describe them generically ("the rental
  app", "the running-event app") and never copy their code, paths, customer data or internal names.
- Keep it boring and scannable. If HANDOFF goes over 80 lines, cut detail and link to the doc instead.
