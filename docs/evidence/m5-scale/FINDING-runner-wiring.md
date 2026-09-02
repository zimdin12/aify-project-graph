# The linkage-scope runner is wired and drives the frozen experiment

**Date:** 2026-09-02
**Built to:** `docs/evidence/m5-scale/PREREGISTRATION-linkage-runner.md`
**Artifacts:** `scripts/linkage-scope-runner.mjs`, `scripts/lib/linkage-scratch-repo.mjs`,
`tests/unit/ab/linkage-runner-wiring.test.js`
**Cost:** zero agent budget.

## ⛔ Claim ceiling, first

**This proves the harness can carry the experiment. It proves nothing about the product.** Every
number the runner currently emits comes from a mock executor that is deliberately bad at the task, and
the runner prints that warning next to its own output. The key already says it about tier A:
*"Success here is NOT evidence of field value and must never be reported as such."*

Running for real costs 72 agent runs and is Steven's call. No real executor ships: the default is
`mock`, and pointing `--executor` at an agent adapter is a separate, deliberate act that cannot happen
by running the script.

## What it does

Preflight (running the preflight **script**, not a copy of its logic) → materialise each class's
corpus into a scratch git repo → index the graph arm only, tearing C6 → ask the class's **exact**
prompt text → score with the unmodified rubric → report per tier, per class, per runtime, per arm.

There is deliberately **no overall number**. The key forbids averaging synthetic tier A with real
tier B, so the report has no key that could hold a pooled figure.

## The control that mattered: the treatment audit

The first version ran all six classes clean and proved nothing. **A C6 cell whose tear silently
failed is byte-identical to C4 and would have been counted as a result** — an inert mutation is the
same green.

Now `tear()` reads the attestation back through the product's own `classifyAttestation`, throws
unless it is `generation_mismatch`, and the verified state travels with every row. The runner prints
`TREATMENT AUDIT — C6 graph rows verifiably torn: n/m` beside the numbers.

Proven able to fail: with the tear neutered, the run reports `0/0 ⛔ INVALID` and lists the row under
`NOT RUN` with the reason `tear did not take: attestation is attested`. Refused, not counted.

## Defects caught while building

1. **Path contract.** The corpus is `corpus/weights.cpp`; every prompt names `src/weights.cpp`.
   Materialising to the corpus path would have pointed the agent at a nonexistent file and scored as
   a routing failure that was really a harness bug. Pinned, with a control that the prompts really do
   name `src/` — otherwise the test would pin whatever the code happens to do.
2. **Runtime was not a grouping level.** The key requires per-runtime reporting — "Hermes and Claude
   Code reported separately, never pooled" — and my report grouped tier/class/arm only. Pooling is
   invisible in the output: a pooled cell looks exactly like a single-runtime cell with more runs.
   Only the shape can rule it out.

## Mutants

Tree committed before each. R-1 (tear made a no-op) → run refuses, audit INVALID. W-1 (materialise
outside `src/`) → path test red. W-2 (pool the tiers) → 2 tests red. W-3 (pool the runtimes) →
3 tests red.

## An honest note about the tearing work that preceded this

C6's `estimand` field in the frozen key already recorded the result my tearing contrast produced:
*"NOT 'does the publication gate change graph_callers output' — measured, it does not; that route is
byte-identical healthy vs torn."*

I had read that class's `tier` and a few other fields days earlier and never read `estimand`, so I
spent a cycle rediscovering something already written down — the same shape as the earlier "a tier B
design I could not locate" error. What the probe adds is a *different substrate* (an executable
regression gate rather than a prose claim) and it caught a live error of mine about the rubric. But
it was not new information, and reading the class in full first would have been cheaper.

## What remains before a real run

- Steven's decision on the 72-run budget (4 repos × 3 tasks × 2 arms × 3 repeats).
- A real executor adapter, which does not exist and should not be written until that decision.
