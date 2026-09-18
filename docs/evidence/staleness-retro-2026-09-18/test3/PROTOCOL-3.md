# Test 3: file-anchored staleness warnings, in two classes, on a second repository

Pre-registered 2026-09-18, before any test-3 output. Steven: "carry on" (the step proposed after test 2).

## What changes from tests 1 and 2, and why

1. **A different repository:** aify-project-graph itself, pinned at 6ec850af (1,880 commits), in a
   read-only clone with origin removed. It is the only other local repo with comparable history and docs.
   I wrote much of it; the grading is done by an independent blind grader for that reason.
2. **Population, derived the same way as aify-comms' `gated_docs()`:** the entry docs README.md and
   AGENTS.md, every `.md` they link that exists, and every `.md` under `integrations/claude-code/` (the
   shipped skills). At 6ec850af that is 36 files (`raw/population.txt`).
3. **The detector fixes from the local v2 run:**
   - import/export aliases, object properties and `this.X =` count as definitions;
   - a plain lowercase word (no uppercase letter, underscore or digit) is not a code-name anchor.
4. **Anchors are FILE-SCOPED.** A symbol defined at W in files D counts as still defined at HEAD only if
   it is defined in one of D, or in the file each was renamed to (`git diff -M --name-status W HEAD`).
   This is the fix for the collision v2 showed, where an unrelated `isEnabled` elsewhere hid a stale note.
5. **Two warning classes, fixed now:**
   - **GONE:** the note points at code that no longer runs. Rules:
     - S1d: the path was deleted and not renamed;
     - S3a: the symbol is still defined but has no code references outside its file(s), comments stripped;
     - S4a: the file exists but no code file references it.
   - **DEAD NAME:** the note uses a name that no longer resolves. Rules:
     - S1r: the path was renamed;
     - S2f: the symbol is no longer defined in its own file lineage (deleted or renamed).
6. **Status filter:** as in test 2, a fresh blind labeller labels every note current, history or unclear
   from the doc text alone. Warnings are kept only on notes labelled current.

## Grading

**The grader of record is an independent blind agent,** not me. It sees each flag's doc, line, anchor,
class and the detector's claim, reads the code itself, and is never shown the expected answer or these
decision rules. It answers two questions per flag:

- **Q1 substance:** does the note, read at HEAD, state or imply something false or misleading because of
  the change? TRUE / FALSE / UNCLEAR.
- **Q2 pointer:** does the named file or symbol still exist under that name as a live code definition at
  HEAD? YES / NO.

It grades every current-note flag if there are at most 60, otherwise a random 60 (seed 20260918),
stratified by class in proportion to the flag counts.

## Decision

- **Build GONE warnings** (notes with a status and a confirmed-at date, plus a commit-time GONE warning)
  if GONE precision (Q1 TRUE / graded GONE flags, UNCLEAR counted against) is at least 50%, and current
  notes flagged are at most 25% of anchored notes.
- **Build DEAD-NAME hints,** a low-severity "this name no longer resolves" pointer check, if at least 90%
  of graded DEAD-NAME flags are Q2 NO (the pointer really is dead). Their Q1 precision is reported and
  does not decide, because the rename question is exactly where two graders disagreed in test 2.
- If GONE fails: do not build warnings; report.

## Limits recorded before the run

- No recall set: I did not pre-select known stale notes in this repo, so this measures precision and
  volume only.
- One grader run, one labeller run (split into two agents by doc).
- Name-and-file matching is still not a resolver. A symbol that moved to a different file without a git
  rename reads as DEAD NAME even when it lives on.
