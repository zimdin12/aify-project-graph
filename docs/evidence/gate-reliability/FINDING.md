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

## A proposed gate that REJECTED ITSELF: mechanical doc-drift detection

Written state decayed five times in one session — the plan claimed shipped work was unpushed and
cited a figure its own evidence file retracts; memory claimed a shipped milestone was held; my own
census under-reported twice from a hand-kept list. Code has mechanical gates for this class (the
negative-assertion ratchet, the cause vocabulary, the authority ledger, the export allowlist, all of
which fired today). Documentation has none, so a gate looked obviously worth building.

**Then I checked whether it would have caught any of the five. It would have caught zero.**

The obvious gate is a numeric one — verify counts cited in docs against the live registry. Measured:
docs cite `of 43` and `of 16`, and the live values ARE 43 and 16. **The counts were never wrong.**

| what actually failed | a count-gate catches it? |
|---|---|
| "IN FLIGHT, NOT PUSHED" on shipped work | no — a STATUS, not a number |
| a retracted figure still cited | no — the number was real; its STANDING was stale |
| memory saying HOLD after shipping | no — a STATUS |
| a hand-kept producer list drifting | no — code drift, not doc drift |
| four wrong denominators | no — fresh analysis errors, not decay |

⇒ **Not shipped.** Every feature must earn its place, and this one earns nothing against the defects
that actually occurred. The failures were judgement and staleness in PROSE — a status outliving the
fact, a retraction not propagating — which no cheap mechanical check reaches.

⚠ What DID work, and is free: **re-deriving status from the artifact before acting on it** (git for
"is it pushed", the evidence file for "is this figure still standing", the live registry for a
producer list). Four of the five were caught that way, in the cycle that would otherwise have acted
on them.
