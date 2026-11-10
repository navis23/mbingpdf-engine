---
name: resume
description: Start-of-session resume for mbingpdf. Reads HANDOFF.md and the current roadmap milestone, verifies the repo state matches, and presents a short briefing with the next step. Use at the start of a new session, or when the user says "resume", "continue", "where were we", "lanjut".
---

# Resume — pick up where the last session stopped

## Steps

1. **Read the record** (in parallel):
   - `HANDOFF.md` (the snapshot — primary source)
   - `CLAUDE.md` if it exists (project rules)
   - `docs/05-roadmap.md` — only the milestone named in HANDOFF
   - last entry of `docs/SESSION-LOG.md`
   - `docs/07-open-decisions.md` — only rows referenced in HANDOFF
   - Any design doc the first next step names (for example `docs/03-architecture.md` for engine work)

2. **Verify reality matches the record** (in parallel):
   - `date`, `git status --short`, `git log --oneline -5`, `git status -sb`
   - If `package.json` exists and `node_modules` is missing → note "run `pnpm install`".
   - Flag every mismatch (HANDOFF says clean but there are uncommitted files; a commit newer than
     the handoff exists; local is behind origin). Don't fix silently — report.

3. **Brief the user** (≤15 lines):
   - Session <N+1>, milestone, one-line "where we are"
   - Anything half-done
   - Items waiting on the owner (ask them now if they block step 1)
   - Mismatches found in step 2
   - Proposed first step (Next steps #1) — then start it unless it needs the owner's input.

## Rules
- Don't re-read the whole `docs/` tree unless the next step needs it.
- Don't re-litigate rows in `docs/07-open-decisions.md`; they stand until the owner changes them.
- The two reference apps are private and this repo is public: read them for requirements when
  needed, but keep anything committed here generic.
- If HANDOFF.md is missing or clearly older than the latest commits, reconstruct from `git log` +
  `docs/SESSION-LOG.md` and tell the user.
