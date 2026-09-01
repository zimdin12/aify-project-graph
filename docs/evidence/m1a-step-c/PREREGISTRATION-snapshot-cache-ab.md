# Document-snapshot cache: controlled A/B PREREGISTRATION

Fixed **before any run**. `n`, order, subjects, predicates, acceptance and the abandon rule are all
committed in advance so a flattering intermediate result cannot end the experiment.

## Why this is required at all

The trigger was a credible sequence, not a cause:

| commit | guard | that test file | result |
|---|---|---|---|
| `e6ad4eb` | v1, no token check | 12,484 ms | pass |
| `43736f0` | v2 | 17,334 ms | pass |
| `83cf19b` | v2 + fixed fixtures | — | **FAIL** (2 budget-limited resume assertions) |

⚠ **That is not causal attribution.** Commits differ, background load differs, and whole-test
duration does not separate document reads from clangd startup and index readiness. It is a reason
to measure, nothing more.

## Subjects — differing only in the snapshot slice

| arm | commit | what it is |
|---|---|---|
| **A** without cache | `83cf19b` | guard v2, one filesystem read per Location |
| **B** with cache | `19f50cf` | identical guard, reads routed through one per-collection snapshot |

`83cf19b..19f50cf` is exactly the snapshot slice: `document-snapshot.js` (new), the `readDocument`
seam in `location-coherence.js`, the per-collection wiring in `cpp-clangd.js`, and the contract
test updated to pass a snapshot. Nothing else.

## Carrier — one, fixed

Single toolchain: `APG_CLANGD` pinned to `C:/Program Files/LLVM/bin/clangd.exe` (22.1.6, sha256
`ad7fd474…`). Same fixture bytes, same `budgetMs`, same `PATH` (unmutated). Recorded per pair:
load identity and host health.

## Design

**n = 6 pairs (12 runs), fixed now.** Counterbalanced: pairs 1, 3, 5 run **AB**; pairs 2, 4, 6 run
**BA**. Order alternates so a warming or drifting host cannot favour whichever arm runs first — the
uncounterbalanced version of this experiment already produced a flattering artifact earlier in this
arc and had to be discarded.

⛔ **The run does not stop early.** All 6 pairs execute regardless of what the first pairs show.

## Primary predicate — FILESYSTEM WORK, not wall time

Wall time is secondary and expected to stay noisy. The mechanism gates are:

1. repeated eligible Locations for one canonical document produce **one** captured read — cached
   typed failures included;
2. **aliases share that read** (8.3 short name, junction, drive-letter case);
3. **distinct canonical files never alias**;
4. a **fresh collection re-reads** after an edit between collections.

## Recorded per run

terminal status · test duration · clangd startup / readiness / time-to-first-file ·
`filesProcessed` / `filesTotal` · snapshot stats (`readsAttempted`, `statsAttempted`,
`cachedDocuments`, `cacheHits`, `retainedBytes`, `countBudgetRefusals`, `bytesBudgetRefusals`) ·
admission accounting (`incoherentLocationsRefused`, `unverifiedLocationsExcluded`).

Plus the narrow case that motivated this: **the exact budget-limited resume assertions**, under the
same load carrier.

## Acceptance

- all four mechanism gates pass;
- **no evidence/admission membership changes** between arms;
- **no new `UNAVAILABLE` or refusal outcomes** in B;
- B does **not worsen** the budget-failure rate;
- then a fresh **bare full-suite green**.

## ⛔ Claim ceiling, fixed in advance

If timing is inconclusive but read-count collapse is proven and the suite is green, the claim is
**I/O elimination only** — *not* latency improvement, *not* reliability improvement, and *not* an
explanation of the budget-limited failure. Those would each need their own evidence, and a green
suite is not one of them.

## Abandon rule

If A and B differ in admitted membership or refusal outcomes, **stop**: the snapshot has changed
evidence semantics, which it must not, and that is the finding rather than a performance result.
