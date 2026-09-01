# The suite's verdict has TWO load-sensitive classes, not one

"Full suite green before push" is the gate this project leans on. A verdict that moves with machine
load makes a real regression indistinguishable from contention — and in one session that cost three
separate investigations, each ending in "it was load".

## Class 1 — the packet live budget. FIXED.

`graph_packet` bounded a symbol→feature lookup at a hard-wired 2000ms. The lookup's own measured
cost is 601ms on a 3958-node repo and 4316ms on a 12126-node one, so under contention it crossed the
line, packet took its timeout branch, and every test asserting on CONTENT failed.

Measured on one unchanged tree:

| suite duration | failures |
|---|---|
| 680s | 0 |
| 2120s | 2 |
| 2693s | 10 |

Failures scaled with duration and every one was budget-shaped. Fixed by `APG_LIVE_BUDGET_MS`
(product default unchanged at 2000, fail-closed on a bad value) with the harness at 8000 —
**bounded on both sides**, because 30000 broke `packet-timeout-not-absence`, which mocks a hang and
needs the budget under its own 20s test limit.

## Class 2 — real-clangd index warmth. OPEN, not fixed.

`tests/integration/code-intel/live-verbs-real.test.js` failed once with
`expected 'not_found_after_retry' to be 'found'`.

Attribution, without argument:
- the only new commit changed **one markdown file, 92 insertions**, nothing executable;
- the test passes **6/6 in isolation**;
- a re-run of the full suite was green, 432 files / 3607 tests.

⚠ **CANDIDATE MECHANISM, NOT PROVEN.** `lsp-collect.js:427` retries once after 30ms when references
come back empty, racing an asynchronously-warming index. The same `not_found_after_retry` state
dominated a separate measurement earlier the same day (8 of 10 reference lookups on an unconfigured
fixture). That is two observations of one state, not a demonstrated cause — a earlier attempt to
pin the 80% figure on this retry was WITHDRAWN when a discriminator showed the real cause was a
missing project manifest.

## Why class 2 is recorded rather than fixed

It fired once. The budget fix earned its place because it blocked every push; reaching into clangd's
warm-up on a single observation, with a mechanism labelled ASSUMED, would be scope creep into a
subsystem whose failure mode is not established. **The honest state is: known-flaky, cause
unproven, one observation.**

⛔ What must NOT happen is the reasoning that nearly did: "the commit is only docs, so the red does
not count." That is how a gate stops meaning anything. The suite was re-run and pushed on a real
green, not on an argument.

## What would settle class 2

A determinism probe on the live path: the same test, N runs, under controlled load, recording
`result_state` each time. If `not_found_after_retry` appears at a rate that tracks load, the retry
is implicated; if it appears at a fixed low rate regardless, it is something else. Not run.
