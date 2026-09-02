# The linkage-scope preflight can actually refuse

**Date:** 2026-09-02
**Instrument:** `scripts/linkage-scope-preflight.mjs`
**Preregistered by:** `docs/evidence/m5-scale/PREREGISTRATION-linkage-runner.md`
**Claim ceiling:** this says the preflight discriminates a fit fixture from a broken one. It says
**nothing** about the product, and being fit to run is not authorisation to run.

## Why a preflight, separately from the runner

A leaked prompt or a silently edited key does not make a run *fail*. It makes it **succeed and mean
nothing**. `prompts.json` states the hazard itself: if a prompt names the mechanism under test, "the
routing measurement is destroyed — the agent is following the prompt rather than choosing." A 72-run
budget spent on a destroyed measurement buys a number with no referent.

So the check runs before run 1, not after run 72.

## Result on the current fixture

```
PASS  LEAK      19 forbidden words, 6 prompts, 0 violations
PASS  LEAK CTL  finds "call": true; rejects "clangd": true
PASS  KEY       6 classes, tiers and graphShouldWin match the preregistration
PASS  CORPUS    all class files present
PASS  RUBRIC    go-ahead: true   refusal: ambiguous
exit 0 — FIT TO RUN
```

The rubric line is the three-valued design working: it fires `true` on the unsafe go-ahead and
declines to *certify* the refusal as `ambiguous` rather than scoring it a win. A rubric that returned
the same value for both could not measure anything, which is exactly what that control tests.

## Every control shown to say NO — same pass, restored after

Tree committed at `eb62a3d` **before** mutating: `git checkout --` has eaten uncommitted work here
before.

| Mutant | Verdict |
|---|---|
| P-1 a prompt leaks the mechanism (`clangd`) | **KILLED** — preflight refused |
| P-2 the key drifts (a class tier silently changed) | **KILLED** — preflight refused |
| P-3 a corpus file named by a class is missing | **KILLED** — preflight refused |

Baseline before each: exit 0. Fixture after: `git status --porcelain` empty.

⛔ The mutants edit a **frozen** fixture and restore it. That is mutation testing, not redesigning
toward the test — the `freezeRule` forbids the latter, and the preflight itself only ever *reads* the
fixture. A preflight that repaired what it found would be committing the very violation it detects.

## The control on the control

The LEAK check reports a zero, and a matcher that never fires reports the **same clean zero** as a
clean fixture. So the matcher is shown in the same pass to find a word that is present (`call`) and
reject one that is absent (`clangd`). Four times in this session a broken instrument handed me an
empty result that I wrote down as a finding; the wrong zero agrees with what you hoped to see, so
nothing collides and nothing prompts the check.

## What this does not cover

- **It does not check that a prompt is ANSWERABLE**, only that it does not leak. A prompt could be
  clean and still unanswerable by either arm.
- **It does not validate the corpus COMPILES.** Class files existing is not the same as an indexable
  translation unit; C6 deliberately wants a torn graph, so "it builds" is not even a uniform
  expectation across classes.
- **`EXPECTED` is a hand-copied mirror of the key.** It catches the key drifting away from the
  preregistration; it cannot catch both being wrong together, because they were written by me on the
  same day from the same understanding.
