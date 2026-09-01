# Differential probe result — step A did not cause the scoped-collect zero

Preregistration: `PROBE-PREREGISTRATION.md` (protocol, subjects, controls and the three outcomes
written before the run). Raw: `PROBE-RESULTS.json`. Harness: `scripts/probe-collect-budget.mjs`.

**Outcome (a): rates and causes are equivalent across subjects.** Step A is innocent of this
failure, and the budget brittleness is recorded below as its own finding rather than absorbed.

## Result

| arm | commit | n | zero runs | cause | median elapsed |
|---|---|---|---|---|---|
| pre-step-A | `8a3675f` | 8 | **1** | `partial_no_files` | 7,460 ms |
| step-A | `29fc344` | 8 | **1** | `partial_no_files` | 7,204 ms |

Controls: **positive** — both arms collected files in at least one run, so neither arm's zeros are
an artefact of a broken environment. **Negative** — an impossible budget (`budgetMs: 1`) produced
`collected: 0` in *both* arms with cause `partial_no_files`, which is the exact signature seen in
the red suite run, so the probe demonstrably observes the failure it is hunting.

## The signal is POSITION, not subject

```
byPosition: position 0 → 2 zeros of 8      position 1 → 0 zeros of 8
```

Both zero runs happened to whichever arm ran **first** in its repetition, and both bailed early
(~3.1–3.3 s against a ~9 s budget) rather than working and running out. Whichever subject pays the
per-rep cold start is the one that starves.

## ⛔ My first run of this probe was confounded, and it flattered the change

The first version ran `pre` then `post` every repetition. That controls for slow drift across
repetitions but leaves **within-rep order confounded with the arm**. It produced:

```
pre  3 zeros of 6        post  0 zeros of 6
```

which reads as "step A is innocent — in fact the pre subject is worse." I was one step from
reporting it. The result favoured the change under test, which is precisely when a design deserves
more scrutiny rather than less; counterbalancing the order collapsed the difference to 1 and 1.

An order effect and a subject effect are indistinguishable in an uncounterbalanced A/B, and the
uncounterbalanced version would have produced a *stronger* headline. That is the whole reason it
had to be thrown away.

## Separate finding: the test's budget is not load-safe

Not step A's, and recorded here so it is not lost inside a cleared suspicion.

`tests/integration/code-intel/scoped-collect-survives-real.test.js` runs with `budgetMs: 9000`, and
its own comment names the tension: *"not so small the index wait eats it entirely."*
`splitCollectBudget` then divides that further to reserve a share for the import. Under parallel
load, clangd startup plus index wait can consume the whole collect budget, and the test fails with
`expected 0 to be greater than 0`.

⚠ **The test and the product share one ambiguous failure string.** A starved clangd and a broken
graph join both surface as that same zero, so the assertion cannot say which happened, and no
number of reruns can separate them. That is the defect worth fixing — not the flakiness itself, but
that the failure carries no cause. The probe had to be built precisely because the test could not
answer the question asked of it.

## What this does not show

- One machine, one load pattern, one small C++ corpus, 8 repetitions per arm. **No claim about the
  failure rate in CI, on other hardware, or under other schedulers.**
- Equivalent rates at n=8 do not prove equal rates; they fail to detect a difference. A small
  effect would not be visible here.
- Nothing here tests the *other* consumer review flagged — code-intel's promotion path through
  `resolveDefinedSymbolNode` — beyond the fact that collect completed normally in both arms.
