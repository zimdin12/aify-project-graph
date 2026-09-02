# Three probes I did not need to build, in one session

**Date:** 2026-09-02
**Cost of the pattern:** roughly two cycles of work that produced no new information.

## The pattern

Three times in one session I designed a mechanical probe to answer a question **the repository had
already answered in writing**, and I found that out only after building or running it:

| # | What I set out to measure | Where the answer already was |
|---|---|---|
| 1 | Does a torn graph change `graph_callers` output? | `ground-truth.json`, C6 `estimand`: *"measured, it does not; that route is byte-identical healthy vs torn."* |
| 2 | Are `graph_callees` / `graph_neighbors` reachable in the default listing? | `callees.js:116-119`: *"graph_neighbors is not in the default tool profile — and neither is graph_callees"*, with a remedy-reachability guard built on it |
| 3 | Does every ambiguity consumer refuse rather than silently pick one symbol? | `tests/unit/query/ambiguous-symbol-guards.test.js`, which already exercises **all eight** verbs |

In each case I had *partially* read the artifact — C6's `tier` but not its `estimand`; `callees.js`'s
absence branch but not the comment 6 lines above it.

## Why the probes were not worthless, and why that is not a defence

A comment asserting a fact and a measurement of that fact are **different substrates**, and this
project has four recorded cases of correct, prominent, adjacent knowledge failing to catch the defect
it described. Converting #1 and #2 into executable gates has real value: a comment cannot go red.

But that is a justification available *after the fact* for any redundant work, and it does not
recover the cycles. The cheaper order is: read the adjacent source and fixture fields **first**, then
decide whether a gate is worth building — building a gate for a known fact is a deliberate choice,
not a discovery.

## What changed as a result

Applied on the fourth attempt this session: before probing whether the M1 refusal reaches every
consumer, I read `symbol_lookup.js:178-182` and found the answer — `callerSetsFrom` is opt-in **by
design**, because a caller set is the answer for `graph_callers` and noise for `graph_trace`. No
probe needed, no cycle spent.

Reading first did surface one real defect the comment itself carried: it claimed **"Six verbs share
this refusal"** when the measured number is **eight** (`callees`, `change_plan`, `consequences`,
`neighbors`, `path`, `preflight` directly; `callers` and `impact` via `target_rollup.js`). A
hardcoded count in a comment is a defect with a delay on it, and a reader trusting "six" would
under-scope a change to shared refusal text. Corrected to name the derivation and point at the test
that enumerates all eight.

## The rule

**Read the adjacent source, comments and fixture fields before designing a probe.** A probe that
replicates a written fact costs a cycle and returns nothing; the same effort spent reading would have
found it, and often finds a second thing — as it did here, where the stale count was sitting in the
sentence directly above the design note I went to read.
