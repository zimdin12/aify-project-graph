# Differential probe — result WITHDRAWN, instrument was broken

Preregistration: `PROBE-PREREGISTRATION.md`. Raw: `PROBE-RESULTS.json`. Harness:
`scripts/probe-collect-budget.mjs`.

# ⛔ THIS DOCUMENT'S ORIGINAL CONCLUSION IS WITHDRAWN

It claimed **outcome (a): "rates and causes equivalent"**, and the commit that carried it
(`1a9dd45`) is titled *"clears step A"*. **Neither is supported.** Review checked the artefacts and
the carrier failed its own preregistered bars.

**The root cause is mine and it is the exact defect this probe existed to remove.** The probe read
`res.budgetExhausted` and `res.filesWalked ?? res.filesConsidered ?? res.fileCount`. Those
top-level names **do not exist** on that response — the real fields are nested under `res.index`
(`index.budgetExhausted`, `index.filesProcessed`, `index.filesTotal`, `index.indexReady`). The `??`
chain turned every miss into `null` silently, so all 16 runs recorded `denominator: null` and
`budgetExhausted: null`, and nothing failed.

So `partial_no_files` was never a cause. It was `status === 'partial'` **wearing a cause's name** —
the same ambiguous surface the probe was built to replace. A fail-open read, inside the instrument
built to stop a fail-open read, with a causal claim published on top of it.

Two further bars failed, both found by review rather than by me:

- **The negative control never entered the carrier.** It ran in a shell and was reported in prose;
  `PROBE-RESULTS.controls` holds only the positive control. A prose report is not a control receipt.
- **Subject identity was never bound.** Results record mutable paths only, and the two probe
  directories were not git repositories, so the claimed `8a3675f` / `29fc344` bytes could not be
  read back from the carrier at all. Agreeing `node_modules` realpaths establish a shared
  dependency set, not source identity.

## What the retained data honestly supports

> Under two **unbound** source directories, counterbalanced order produced **1 zero observation in
> 8 per arm**, with zeros concentrated in position 0. **Causal mechanism unresolved.**

That is not outcome (a). It does not establish equal causes, and it does not clear step A's exact
bytes. The HOLD on step-A acceptance stands until a repaired carrier reports.

The numbers below are retained as the record of what was run — read them against the withdrawal
above, not as a finding.

## Result

| arm | commit | n | zero runs | cause | median elapsed |
|---|---|---|---|---|---|
| pre-step-A | `8a3675f` (UNVERIFIED — see withdrawal) | 8 | **1** | ⚠ not a cause | 7,460 ms |
| step-A | `29fc344` (UNVERIFIED — see withdrawal) | 8 | **1** | ⚠ not a cause | 7,204 ms |

Controls: **positive** — both arms collected files in at least one run; this one is in the carrier
and holds. **Negative** — ⚠ ran only in a shell and was never retained in `PROBE-RESULTS.json`, so
it is **not a control receipt** and is not claimed as one.

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
