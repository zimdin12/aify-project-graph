# Rehearsal grading — STEP 1: what did each run choose?

You are grading the REHEARSAL of the usefulness trial (aify-dashboard docs/PREREGISTRATION-v0.8.md), not the trial.
Eight runs, coded R1-R8, each in its own folder with `transcript.md` (the agent's calls, cut results, final message) and
`patch.diff` (what it changed). Paths that would identify the run's condition are masked as `<ARM>` / `<AGENT>` /
`<PROJECT-ID>`. Each run had one of two conditions; which one is hidden until step 3.

**Step 1 is choices only.** You do not get the merged outcomes or the rubric until you have handed this step in, and you
may not revise it afterwards. For each run and each decision point, record what the run chose, from its transcript and
patch, or `UNKNOWN` if you cannot tell. A choice that is not among the options: write it down as `OTHER: <what>`.
Then guess the run's condition (`X` or `Y`, or `?`), with one line on why. The guess tests the masking: guess honestly,
including "no idea".

Please do not open anything outside this folder for this step. In particular, not the APG repo's
docs/evidence/rehearsal-2026-10-05/ (it holds the merged outcomes) and not my scratchpad (it holds the allocation).

## Task T1 (runs whose header says `task: T1`)
Prompt the agents got: `graph_callers` can answer `NO CALLERS from "<dir>"` for a directory scope that does contain a
caller (about 120 heuristic callers in one directory, one LSP_VERIFIED caller in another, `file` set to the other).
Find the cause and fix it, with a test.
- D1 Where the run applies the `file` scope relative to the edge-fetch cap: in the query before the cap / after the cap / by raising or removing the cap / other.
- D2 Whether the capped fetch orders edges by evidence (verified first): yes / no.
- D3 Whether the run consulted the sibling verb `graph_callees` and followed its approach: consulted and mirrored / consulted, not mirrored / not consulted.
- D4 How the path scope is matched: prefix comparison / SQL LIKE / other.
- D5 What an empty scoped result answers: a scoped absence / the unscoped `NO CALLERS for "<target>"` / other.
- D6 A regression test reproducing the case: added / not added.

## Task T2 (runs whose header says `task: T2`)
Prompt: `graph_health` reports `lspVerifiedPctOfVerifiableInScopeCalls: 4995`, from 949 verified over 19 verifiable.
Find the cause and fix it, with tests.
- D1 Numerator and denominator: from the same rows / from separate queries / other.
- D2 The set of verifiable languages: derived from a backend registry or table / a hardcoded list (kept or widened) / other.
- D3 A second hand-maintained copy of that set in health.js: removed / left / not noticed.
- D4 A percentage over 100: refused (null plus a reason) / clamped / left / other.
- D5 The `non_cpp_language` reason: renamed / kept / other.
- D6 Existing tests whose premise changed: examples changed, invariants kept / deleted or weakened / not touched.

## Hand-in
One table per task: rows = runs, columns = D1-D6 + condition guess + one line of reason. Send it to graph-tech-lead.
Step 2 (outcomes and rubric) follows; then step 3 (the allocation).
