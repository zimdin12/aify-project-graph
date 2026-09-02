# Consuming publication state does not imply changing under tearing

**Date:** 2026-09-02
**Preregistered:** `docs/evidence/m5-scale/PREREGISTRATION-tearing-contrast.md` (before the probe existed)
**Instrument:** `tests/unit/ab/tearing-changes-verb-output.test.js`
**Cost:** zero agent budget.

## Result

| verb | deterministic | changes under tearing |
|---|---|---|
| `graph_health` | yes | **yes** — `"attested"` → `"generation_mismatch"` |
| `graph_callers` | yes | **no** — byte-identical, 563 → 563 chars |
| `graph_search` | yes | **no** |

Not exercised, and named rather than dropped: `graph_status`, `graph_impact`, `graph_packet`.

## What it settles

My route census found 29 verbs consuming publication state against `GATE_CARRYING_VERBS`' three
names, and `callers.js:35` — `if (freshness.blocker) return freshness.blocker` — made a change look
certain. I was one step from reporting the rubric as a false-negative generator.

**That would have been a noun-slide.** "Consumes publication state" and "changes under tearing" are
different claims. Measured, `graph_callers` does not change: the blocker path exists but does not
fire for a static generation mismatch — it is for an unattested *rebuild*.

**The rubric is right. `GATE_CARRYING_VERBS` is left untouched**, which is what the preregistration
committed me to for this outcome.

Reading source predicted a change and measurement refused it. That substitution — reading standing in
for measuring — has now falsified three predictions in this project.

## The probe's first run was broken, and the abandon rule caught it

Both the positive control and the question failed on run 1. Two independent defects:

1. **`graph_health` returns an object.** `String()` produced `"[object Object]"` on both sides, so the
   comparison was vacuous for exactly the verb meant to validate the probe.
2. **My "the tearing was applied" control called `classifyAttestation` directly** with the torn
   number. It proved the *classifier* works; it never established that the verb path sees a torn
   state. I controlled the instrument rather than the artifact the operation actually reads.

Had the abandon rule not been written down first — *if `graph_health` does not move, conclude nothing*
— run 1 produced a clean "graph_callers does not change" from a probe that could not have detected a
change in **anything**. The right answer, from an instrument with no power to find the wrong one.

That the answer survived a *working* instrument is what makes it evidence.

## Mutants

Tree committed at `bec6d6a` before mutating.

| Mutant | Verdict |
|---|---|
| T-1 `tear()` made a no-op | **KILLED** — trust verb stops moving |
| T-2 `ser()` reverted to `String()` | **KILLED** — same control, vacuous comparison |

Determinism is measured in the **same pass** as the contrast, so a merely non-deterministic verb can
never be reported as gate-carrying.

## Consequence for the census finding

`FINDING-route-census-publication-state.md` stands as written — 29 consumers, and the delete-decision
route reaching none of them — but its ceiling is now sharper than I first stated it:

> A verb that opens the publication door does **not** thereby change what it says when the graph is
> torn. The census bounds which verbs *could* be moved by a publication-state treatment. Only a
> contrast like this one shows which actually **are**.

The census's negative column keeps its full force: a verb with no door cannot change under tearing,
so `code_intel_references` and `code_intel_hierarchy` remain unmovable by such a treatment — the
`knownRouteGap` conclusion is unaffected.

## Ceiling

One tearing mode (generation mismatch), a small JavaScript fixture, verb functions called directly.
Says nothing about C++, about `LEGACY_UNATTESTED` / `NEVER_COMPLETED` / `MANIFEST_UNUSABLE`, or about
whether a change is *useful* to an agent — that is the A/B's question, not this probe's.
