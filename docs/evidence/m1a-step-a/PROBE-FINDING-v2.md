# Differential probe, repaired carrier — outcome (c): the failure did not reproduce

Preregistration: `PROBE-PREREGISTRATION.md`. Raw: `PROBE-RESULTS-v2.json`. Harness:
`scripts/probe-collect-budget.mjs`. The withdrawn v1 attempt: `PROBE-FINDING.md`.

**Outcome (c), written before the run: "neither arm reproduces the zero under this load → the probe
failed to recreate the conditions, and that is reported as such. It is NOT read as (a)."**

That is what happened. **Step A is not cleared by this run.** It is also not implicated. The
question is still open, and saying so is the result.

## What the repaired instrument reports

| arm | commit | clean | has step A | n | zero runs |
|---|---|---|---|---|---|
| pre | `8a3675f` | yes | **no** | 4 | **0** |
| post | `29fc344` | yes | **yes** | 4 | **0** |

Subjects are bound *in the results*: commit, tree hash, working-tree-clean flag, the list of source
files hashed, and their SHA-256. The run aborts if either subject is dirty, is at the wrong commit,
if `pre` contains the step-A module, if `post` lacks it, or if both subjects hash identically.

Controls — **all three now in the carrier**, not in prose:

```
positive_eachArmCollectedAtLeastOnce          true
negative_impossibleBudgetYieldsZeroBothArms   true
instrument_fieldsReadableAndDiscriminating    true
```

Instrument liveness: `unreadable=[]`, and `status`, `indexReady`, `budgetExhausted`,
`filesProcessed` all **change** between a normal and an impossible budget. A field that never
changes cannot discriminate; a field that never resolves is exactly the v1 defect.

## What v1 got wrong, kept because the failure is worth more than the result was

v1 read `res.budgetExhausted` and `res.filesWalked ?? res.filesConsidered ?? res.fileCount`. Those
top-level names **do not exist** — the real fields are under `res.index`. The `??` chain turned
every miss into `null` silently, all 16 runs recorded `null`, nothing failed, and I published a
causal claim on top of it. **A fail-open read inside the instrument built to stop a fail-open
read.** `partial_no_files` was `status === 'partial'` wearing a cause's name.

Review found it by reading the committed JSON, not the prose. Every guard in this version exists
because of it.

## An observation that changes how the zero must be read

**Every subject run reported `budgetExhausted: true` and still collected a file.** Budget
exhaustion is the *normal* end state here, not the failure. So `budgetExhausted` alone cannot
explain a zero — what distinguishes the failure is whether anything was collected *before*
exhaustion. Any future attribution has to measure time-to-first-collected-file, which this run
does not.

That also retires the hypothesis I was carrying from the test's own comment: the 9 s budget being
exhausted is not itself the defect.

## What this does not show

- **The failure did not reproduce**, so no cause was captured for it, and no rate can be compared.
  n=4 per arm with zero events on both sides is not evidence of equality — it is absence of the
  event.
- v1 *did* observe zeros (1 in 8 per arm) under nominally the same load. v2 changed the run
  structure (four runs per repetition rather than two), so the load pattern is not identical and
  the non-reproduction may be an artefact of that.
- One machine, one small C++ corpus. No claim about CI, other hardware, or other schedulers.
- Nothing here exercises the promotion path through `resolveDefinedSymbolNode` beyond collect
  completing normally in both arms.

## Standing position

The scoped-collect zero remains **unattributed**. The step-A HOLD is review's to lift; this run
gives a sound instrument and no event to attribute. The separate, still-valid finding is that the
integration test and the product share one ambiguous failure string, so the test cannot say which
occurred — that is the defect worth fixing, independent of what caused any particular red run.
