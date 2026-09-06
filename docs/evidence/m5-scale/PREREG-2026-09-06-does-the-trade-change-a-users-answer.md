# Preregistered: does the precision/recall trade change what a USER is told?

**Written 2026-09-06 before any answer is read.**

Everything so far is about EDGE COUNTS. `graph_callers` reads those edges, so both the ~271 genuine
recoveries and the ~712 presumed collisions reach it — but nobody has looked at an ANSWER. A count
that changes and an answer that changes are different nouns, and this session has already paid three
times for conflating them.

## The two questions, and they are separate

1. **Does a REAL recovery reach the answer?** Take symbols from the graded-REAL set and call
   `graph_callers` on the live (forced-rebuild) graph. The recovered caller must appear.
2. **Does a COLLISION reach the answer?** Take `has` and `dir` — the two worst offenders
   (`collect_code_intel.has` fan-in 55→254) — and call `graph_callers`. Count how many returned
   callers are genuine.

## Method

Drive the REAL SERVER over JSON-RPC (`scripts/smoke.mjs` transport), never the module. For each
symbol, read the returned caller list and grade each entry against the source, using the SAME three
grades as the edge grading: REAL / COLLISION / UNDECIDABLE.

⚠ **The verb collapses class rollups and applies a `top_k` budget**, so the printed list is not the
edge set. That is precisely why this has to be measured on the answer rather than inferred from the
edges — the verb may already be filtering the collisions out.

## Decision rule, fixed now

| Observation | Verdict |
|---|---|
| Recovered callers appear AND `has`/`dir` return mostly genuine callers | The trade favours users: recall up, precision damage absorbed by the verb |
| Recovered callers appear AND `has`/`dir` return mostly junk | A real trade reaches the user; the verb needs a short-name guard, and `graph_callers` already warns about overcount — check whether that warning FIRES here |
| Recovered callers do NOT appear | The edge-level finding does not reach the answer at all, and the whole arc is about a number nobody reads |

**Abandon rule.** If the verb refuses or truncates so heavily that fewer than 5 entries can be graded
per symbol, report that the answer surface cannot be measured this way rather than grading a stub.

## Claim ceiling

⛔ One repository, one graph state, a handful of symbols. This is a spot check on whether the effect
is VISIBLE to a user, never a rate.
⛔ The graph is currently in its FORCED state. The drifted graph is gone, so the "before" side of any
answer comparison is unavailable — only the recorded digests describe it.
