# Document-snapshot cache: controlled A/B — **I/O elimination only**

Preregistration fixed before the run (n, order, predicates, claim ceiling, abandon rule).
Subjects differ **only** in the snapshot slice — `83cf19b..19f50cf` touches four files:
`document-snapshot.js` (new), the `readDocument` seam, the per-collection wiring, and the contract
test updated to pass a snapshot.

| arm | commit | |
|---|---|---|
| **A** | `83cf19b` | guard v2, one filesystem read per Location |
| **B** | `19f50cf` | identical guard, reads through one per-collection snapshot |

Carrier: `APG_CLANGD` pinned to clangd 22.1.6, same fixture bytes, same budget, `PATH` unmutated.
n = 6 pairs, counterbalanced AB/BA, **all pairs run** — no early exit.

## PRIMARY predicate — filesystem work: **PROVEN**

Measured on the many-reference collection:

| | |
|---|---|
| admitted location records | 2001 |
| `readsAttempted` | **2** |
| `cacheHits` | 2049 |
| `cachedDocuments` | 2 |
| `retainedBytes` | 101 |

Repeated eligible Locations for one canonical document produce **one** captured read.

## SECONDARY predicate — wall time: **INCONCLUSIVE**

| arm | median (ms) | min | max | n |
|---|---|---|---|---|
| A no-cache | 18,176 | 13,994 | 18,360 | 3 |
| B with-cache | 18,256 | 12,784 | 22,836 | 5 |

Medians are within noise of each other and B's is marginally *higher*. **No latency improvement is
claimed or supported.**

### ⚠ The timing sample is biased, and the bias is mine

`fileMs` is only emitted by a **passing** run. A failed 3 of 6 and B failed 1 of 6, so A's median is
computed over its 3 *successful* — and therefore faster — runs while its slow failures are absent
from the sample entirely. **The arm that failed more has the more flattering timing denominator.**
That is a conditioning-on-success defect in my harness, not a property of the code, and it means
the timing comparison cannot be repaired by adding runs. It would need duration captured
independently of terminal status.

## Budget-failure rate

| arm | runs with failures | budget-assertion failures |
|---|---|---|
| A no-cache | **3 / 6** | 3 |
| B with-cache | **1 / 6** | 1 |

Acceptance required that B **not worsen** the rate. It does not.

⛔ **No reliability improvement is claimed.** n = 6 per arm; 3-vs-1 on that sample is not
significant, and **B failed too**. The cache does not eliminate the failure.

## What this changes about the original trigger

The sequence that started this — 12,484 ms (v1) → 17,334 ms (v2) → FAIL — looked like v2 causing a
budget overrun. **Both arms here carry v2**, and both can fail. So this experiment does not
establish that v2 caused the original failure, and it does not exonerate it either; it was never
designed to. The honest reading is narrower: **this budget-limited integration test fails under
full-suite load in both arms**, at 3/6 and 1/6.

That makes the test a weak gate under load, independent of the cache. Recorded here, owned by
whoever next touches that test rather than folded into this repair.

## Claim, at the preregistered ceiling

> Timing inconclusive, read-count collapse proven, full suite green
> (`19f50cf`: `VITEST_EXIT=0`, 422 files, 3547 passed) →
> **claim I/O elimination only.**

Not latency. Not reliability. Not an explanation of the budget-limited failure.

## Abandon rule — not triggered

Admitted membership and refusal outcomes are identical between arms; no new `UNAVAILABLE` or
refusal outcomes appear in B. The snapshot did not change evidence semantics, which was the
condition that would have stopped the work and made *that* the finding.

## Receipts

`receipts/suite-19f50cf-GREEN.txt` · `receipts/suite-83cf19b-RED.txt` (preserved unchanged) ·
per-pair rows with load identity at `ab-snapshot-rows.json`.
