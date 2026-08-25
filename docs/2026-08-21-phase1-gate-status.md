# Phase 1 acceptance gate — measured, 2026-08-21

The roadmap's Phase 1 gate reads:

> Stratified frozen hand-labelled sample, including negative-control docs using the same word in
> ordinary prose. **Precision floor ≥0.95 per admission rule, not aggregate.** Recall disclosed as a
> floor. **A rule below the floor is deleted, not rescued by ranking.** `the field test` reproduces
> independently, on **both** repos, before it is called done.

This page states where that stands, measured from the committed evidence rather than remembered.

## Precision — MET, per rule, from full populations

| admission rule | precision | population | repo | graded by |
|---|---|---|---|---|
| `doc_ref:path-scoped` | **0.9697** | full | aify-project-graph | the field test |
| `doc_ref:qualified` | **1.0000** (12/12) | full | echoes_of_the_fallen | the field test |
| `doc_ref:shaped` | **0.9677** (90/93) | full | echoes_of_the_fallen | the field test |
| tier-3 partial-path supplement | **1.0000** | full | aify-project-graph | the field test |

All three live rules clear the 0.95 floor **individually**. These are FULL-POPULATION grades, not
samples — `doc-refs-grade-shaped-echoes.json` states `method: FULL POPULATION, graded from the
document prose rather than from the resolved edge. Not sampled.`

**The delete rule was honoured.** `doc_link:inline-basename` graded **0.7083** and was DELETED at
`0bd5b94`, not rescued by ranking. Its cost is recorded rather than hidden: 85 correct edges lost,
and all 35 false positives shared one target — an ecosystem-standard build-artifact filename
resolving to a test fixture.

### ⚠ A false alarm I nearly filed, kept as a caution

`doc-refs-grade-shaped-echoes.json` carries the rule name `doc_ref:shaped + doc_ref:qualified` and a
single combined precision of `0.9714`. Because the gate forbids aggregates, that looked like a
finding: two rules behind one number.

I then computed the split arithmetically — the file's note says "shaped 90/91", and 105 − 91 = 14,
102 − 90 = 12, giving **qualified = 12/14 = 0.857, below floor**. A precise, alarming, wrong number.

The file's `edges` array holds all 105 per-edge verdicts. Measured directly: `qualified` is **12/12
= 1.0000** and `shaped` is **90/93 = 0.9677**. My inference assumed 91 rows where there are 93.

⇒ The aggregate label is a **presentation** problem, not a measurement one: the per-rule data is
present and both rules clear the floor. ⛔ And the lesson is the one this project keeps relearning
from the other direction — an instrument that fails in the ALARMING direction is not the safe kind
of wrong. A false alarm spends a reviewer's attention as fast as a false green.

## Recall — NOT MET, and the reason is structural

`docs/evidence/doc-ref-recall-fc45e0d7.json`:

```
what   : Stratified sample of REFUSED spans, for a recall FLOOR. Verdicts are NOT filled in.
totals : admitted 82 · refused_total 11999 · refused_counting_toward_recall 11351
```

The sample is built and **ungraded**. The ratio is why: **82 admitted against 11,351 refused is
138:1.** At that ratio a 0.7% miss rate in the refused pile would halve recall, and no feasible
hand-graded sample excludes it.

⇒ **"Recall disclosed as a floor" may be unsatisfiable as written for this corpus.** That is a
wording decision for the referee and Steven, not something to quietly redefine into something
achievable. The honest options are to state recall as UNMEASURABLE-BY-SAMPLING with the ratio as the
reason, or to change what the gate asks for.

## Independent reproduction — PARTIAL

`the field test` graded `path-scoped` on aify-project-graph and `shaped`+`qualified` on
echoes_of_the_fallen. **No single rule has been graded on both repos**, so "reproduces on both
repos" is satisfied at the level of the measurement programme but not per rule.

⚠ The recall sample is `graded_by: this project` and carries its own warning:
`FIRST-PARTY GRADE. The rule author graded their own recall; treat as a self-report pending
independent reproduction.` That flag is correct and stands.

## What this means

Phase 1 is **closer to done than the roadmap text suggests**, and the remaining blocker is not
skipped work — it is a corpus shape that defeats the measurement the gate asks for. Precision is
met, per rule, on full populations, with the sub-floor rule deleted as specified.

⇒ Two things need a decision, and neither is mine to make alone:
1. whether "recall disclosed as a floor" is restated for a 138:1 corpus, or the gate accepts an
   explicit UNMEASURABLE with the ratio as evidence;
2. whether "both repos" means per rule, or per measurement programme.
