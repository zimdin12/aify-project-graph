# Rehearsal grading: STEP 2, merged outcomes and rubric

Step 1 is locked (your message 1791187907319-33f2ed15). Do not revise it. Here are the merged outcomes, the choices the
real fixes made, for each decision point:

## T1 (merged fix 5d152a1a)
- D1 Where the scope filter runs: before the edge cap (in SQL), or after the cap / by raising the cap. *Merged: in SQL, before the cap.*
- D2 Evidence priority in the capped fetch: verified edges ordered first, or not. *Merged: yes.*
- D3 Uses the sibling verb's existing pattern (callees.js already had the ordered cap): consulted and mirrored, or reinvented. *Merged: mirrored.*
- D4 Path scope by prefix comparison, or by LIKE. *Merged: prefix, because paths may contain % or _.*
- D5 An empty scoped result: answered as a SCOPED absence, or falls through to the unscoped `NO CALLERS for "target"`. *Merged: scoped, one shared definition for both exits.*
- D6 A regression test reproducing the ordering case: added, or not. *Merged: added.*

## T2 (merged fix dcda0f71)
- D1 Numerator and denominator: computed from the same rows (subset by construction), or kept as two queries. *Merged: same rows.*
- D2 The verifiable-language set: derived from the LSP backends table, or a hardcoded list kept or widened. *Merged: derived.*
- D3 The second hand-maintained copy of that set in health.js: removed, or left. *Merged: removed.*
- D4 A percentage over 100: refused (null plus a reason), clamped to 100, or left. *Merged: refused, NOT clamped.*
- D5 The `non_cpp_language` reason, now a wrong cause: renamed (no_lsp_backend_for_language), or kept. *Merged: renamed at both copies.*
- D6 Tests whose premise expired (JS/TS now verifiable): example languages changed with the invariants kept, or tests deleted or weakened. *Merged: invariants kept, examples changed to php and glsl.*

## Rubric
1. **Per decision point:** mark each recorded step-1 choice MATCH, DIFFERENT, or UNKNOWN, against the merged outcome above.
   DIFFERENT is not automatically wrong. If a run's different choice is as good or better, say so in one line: the
   merged fix is a reference, not an oracle.
2. **Per run, quality 1-5:**
   - 5: the reported bug is fixed at its cause, with a regression test that fails without the fix;
   - 3: the bug is fixed, but with a weaker or missing reproduction, or with a side issue left;
   - 1: not fixed, or fixed at a symptom.
   One line of evidence each (file:line in patch.diff).
3. **Per run, one line:** did the run claim more than it verified (e.g. "tests pass" when it did not see them finish)?

Hand in one table per task: rows = runs; columns = D1-D6 match marks, quality, overclaim, one line of note. Then step 3
(the allocation) follows.
