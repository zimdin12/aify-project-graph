# Rehearsal protocol: tasks, decision points, carrier, grading (agreed with dashboard-manager, 2026-10-05)

Not the trial. Neither task is one of the 5 eligible trial tasks (d8c946ad, a0d5b131, 9fa2bd05, 27c5c422, 1ef73285), nor
72996bce. Both predate the map (59cbae3a), checked with `git merge-base --is-ancestor`. Neither commit message mentions the
grader. Base = the fix's parent; the arm checkout is a `git archive` of the base.

## T1: base 5d152a1a^ (callers-and-callees). The layer contains the answer: a POSITIVE CONTROL for exposure and attribution

**Prompt given to the agent** (symptom only):
> `graph_callers` can answer `NO CALLERS from "<dir>"` for a directory scope that does contain a caller. Reproduction: a
> target with about 120 heuristic callers in one directory and a single LSP_VERIFIED caller in another directory; asking
> `graph_callers` with `file` set to that other directory answers NO CALLERS. Find the cause and fix it, with a test.

**Hindsight in the layer, by construction:** the 550643ef map's callers-and-callees description says "with the file filter
applied in SQL before that cap … rankCallers puts LSP_VERIFIED edges first". So a treated agent that READS the layer gets
the answer, and should cite the feature. If it does not, either the carrier failed or the agent never looked. That is the
question a rehearsal can answer.

**Decision points** (from the merged outcome):
- D1 Where the scope filter runs: before the edge cap (in SQL), or after the cap / by raising the cap. *Merged: in SQL, before the cap.*
- D2 Evidence priority in the capped fetch: verified edges ordered first, or not. *Merged: yes.*
- D3 Uses the sibling verb's existing pattern (callees.js already had the ordered cap): consulted and mirrored, or reinvented. *Merged: mirrored.*
- D4 Path scope by prefix comparison, or by LIKE. *Merged: prefix, because paths may contain % or _.*
- D5 An empty scoped result: answered as a SCOPED absence, or falls through to the unscoped `NO CALLERS for "target"`. *Merged: scoped, one shared definition for both exits.*
- D6 A regression test reproducing the ordering case: added, or not. *Merged: added.*

## T2: base dcda0f71^ (health-and-trust). The layer does NOT contain the answer: NEUTRAL

**Prompt given to the agent:**
> `graph_health` reports `lspVerifiedPctOfVerifiableInScopeCalls: 4995`, from 949 verified over 19 verifiable. Find the
> cause and fix it, with tests.

**Layer content:** the health-and-trust description covers trust levels, next actions, storage and stale refusal, and
nothing about coverage percentages. Citing it would be citing something irrelevant.

**Decision points:**
- D1 Numerator and denominator: computed from the same rows (subset by construction), or kept as two queries. *Merged: same rows.*
- D2 The verifiable-language set: derived from the LSP backends table, or a hardcoded list kept or widened. *Merged: derived.*
- D3 The second hand-maintained copy of that set in health.js: removed, or left. *Merged: removed.*
- D4 A percentage over 100: refused (null plus a reason), clamped to 100, or left. *Merged: refused, NOT clamped.*
- D5 The `non_cpp_language` reason, now a wrong cause: renamed (no_lsp_backend_for_language), or kept. *Merged: renamed at both copies.*
- D6 Tests whose premise expired (JS/TS now verifiable): example languages changed with the invariants kept, or tests deleted or weakened. *Merged: invariants kept, examples changed to php and glsl.*

## Grid
2 runtimes (claude Sonnet 5.5, hermes gpt-6.1-sol at medium) × 2 arms (A: dashboard features graph, B: empty) × 2 tasks = 8 runs, one fresh session each.
A choice the grader cannot determine is UNKNOWN. A choice off the list is not a decision point.

## How T1 is reported (dashboard-manager, 2026-10-05)
T1 is a positive control for exposure and attribution, never evidence that the layer changes decisions. Two outcomes are
findings:
- arm A never reads the layer (no exposure as the prereg defines it): the carrier or the agent's habits failed;
- arm B reaches D1-D3 from the code alone: callees.js already holds the ordered cap, so T1 cannot discriminate even
  when leaked. That matters before picking trial tasks like it.

The arm-B tree for T1 is checked by CONTENT as well as filename: a code comment or doc in the base that paraphrases the
550643ef description is the same leak.

## Carrier (agreed 2026-10-05)
- **Claude:** headless `claude -p --strict-mcp-config --mcp-config=<arm>.json`, cwd = arm root. The init record's server
  list is the claim; the calls are the evidence. A run counts only if the init list shows aify-dashboard alone AND no APG
  tool appears in any call. If `--strict-mcp-config` does not suppress plugin-provided APG, every Claude arm is VOID and
  the route changes (profile or settings); it is not relabelled.
- **Hermes:** one profile per arm. The profile login probe comes first. Before the first arm run, list the profile's tools
  from inside a run to prove it has no APG. `--usage-file` is kept beside state.db: two records, cross-checked by
  `scripts/lib/hermes-run-usage.mjs`.
- **Natural-setup probe:** each of the 7 spawned agents is used once, on a fresh first session. It measures APG tool
  reach as installed, with no dashboard present, and says nothing about the dashboard layer.

## Found in the rehearsal: grader ordering
The grader works in three steps, each locked before the next starts:
1. **Choices.** Before reading any transcript, the grader gets the decision points with the bracketed merged outcomes
   stripped. Per run, they record what the run chose at each point, or UNKNOWN, and their guess at the run's arm.
2. **Correctness and quality.** Then they get the merged outcomes and the rubric, mark each recorded choice right or wrong,
   and score quality. Step 1 may not be revised.
3. **Allocation.** Only then is the allocation revealed.

Why: the prereg asks whether "a decision changed", which is a fact about the choice. A grader who knows the right answer
while reading sees choices through it. The arm guess in step 1 tests the masking for free. If this ordering holds in the
rehearsal, it becomes a prereg amendment before the trial's first query.

T2's discriminating points are D4 (refused, not clamped) and D6 (examples changed, invariants kept). The others are
mostly mechanical, which is acceptable for a neutral control.

## Stated limits
n=1 per cell per task: anecdote, not finding. T1's answer leaks by design. The cost figure is a PROXY (task size drives tokens).
Claude and Hermes token fields are not comparable by name: whether Hermes' input_tokens includes cache reads is unknown.
