# The test stack measured: not bloated, but 28s of it was literal sleeping

**Date:** 2026-09-02
**Preregistered:** `docs/evidence/process/PREREGISTRATION-test-stack-optimisation.md`
**Ask:** "we have 3738 tests !!! optimize, remove duplicates ... this stack must suck"

## The premise did not survive measurement

From the runner's own JSON report (452 files, 3742 tests, 463 s of summed file duration):

| fact | value |
|---|---|
| files running in **under 1 second** | **336 of 452 (74%)** |
| share of duration in the **top 10% of files** | **65%** |
| share in the top 20 files | 45% |
| duplicate `it()` titles across files | 14, **most of them parser artifacts** |

The 14 "duplicates" are mostly template-literal titles (`"skipped — ${skipReason}"`, `"★★★ "`) that
truncate to the same string in my scan. Of the candidates that looked genuine, **none survived
inspection** — see below.

⇒ This is **not** thousands of pointless tests. It is a small number of expensive ones, and the cost
is **waiting**, not redundancy.

## Zero genuine duplicates found

The preregistered rule: REDUNDANT means deleting one leaves the property still covered. Both real
candidates fail it:

- `"★★★ the edge carries a REAL source line, not 0"` — `doc-links` drives `detectDocLinks` on a
  markdown link; `doc-refs` drives `detectDocRefs` on a backticked reference. **Two extractors, two
  edge types.** Deleting either leaves one extractor's line behaviour unproven.
- `"⛔ the denominator is ELIGIBLE, never IN-SCOPE"` — one asserts it on
  `buildAbsenceTrustLine` (the **prose an agent reads**), the other on `spineCoverage` (the
  **structured field**). Same property, two surfaces — and this project has repeatedly found the
  field right while the prose was wrong.

**The shared wording is a naming convention for one defect class applied to different subjects.** That
is good practice, not waste.

## What was actually wasteful: 28 s of sleeping, now removed

**1. `packet-timeout-not-absence.test.js` — 24.60 s → 1.50 s.** The most expensive file in the suite,
3 tests. `vitest.config.js` sets `APG_LIVE_BUDGET_MS=8000`, and the file hangs the lookup forever so
the budget is what fires: 3 × 8 s. The hang **stays** — it makes the timeout deterministic rather than
machine-speed dependent. The eight seconds did not need to be eight: a hang exceeds 250 ms just as
reliably. Set before the dynamic import, because the budget is resolved once at module load and a
later change would be **inert while looking identical**.

**2. `stale-process-not-cached.test.js` — 11.8 s → 6.87 s.** Two 5.2 s sleeps, and they are **not the
same thing**:
- Test 1 asserts the verdict **cache expires**. Waiting out the real TTL *is* the assertion. **Kept.**
- Test 2 asserts only that **immutable identity survives a re-evaluation** — it does not care what
  triggered one. `server-build.js:641` already exports `_resetServerBuildCache` for exactly this, and
  it had been sitting unused while the test that needed it slept.

Both still catch their bugs, proven by mutation: P-1 (timeout collapsed into "not found") and S-1
(immutable clobbered on recompute) each turn their test red.

## Nothing was deleted

The preregistered deletion rule — name the bug it caught, and show another test still catching it —
was never satisfied for any test, because no genuine redundancy was found.
`suite-composition.test.js:10` had already reached the same conclusion for its own class: *"the fix is
classification, not deletion."*

## Ceiling

Timing is **one run on one machine**, and the baseline ran while clangd processes from earlier work
were contending. The **file-level** savings are measured directly in isolation (23.1 s and 4.9 s); the
suite-level delta is not cleanly attributable from a single pair of runs. This measures **cost and
redundancy only** — it makes no claim that the suite's coverage is adequate.

## What is left, and why I stopped

The remaining top-20 files are LSP/clangd-bound, where the time is real work rather than waiting.
`server-toolset.test.js` (12.4 s, 17 tests) spawns a server per test and could batch — a real but
larger refactor, recorded rather than started.
