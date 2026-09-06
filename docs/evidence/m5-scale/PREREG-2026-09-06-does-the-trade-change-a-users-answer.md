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

---

## ⛔ RESULT, 2026-09-06 — BOTH halves reach the user, and the guard against one CANNOT FIRE

Driven on the real server over JSON-RPC, `graph_callers` with `top_k: 25`.

### Q1 — do the graded-REAL recoveries reach the answer? **YES**

```
graphCallers      → inspectReadFreshness  CALLS mcp/stdio/query/verbs/callers.js:32
attestationFrom   → classifyPublication   CALLS mcp/stdio/query/verbs/health.js:456
graphStatus       → classifyPublication   CALLS mcp/stdio/query/verbs/status.js:11
```

Those are the exact edges graded REAL by hand. `inspectReadFreshness` returns 25 rows,
`classifyPublication` returns 3 — all genuine. **The recovery is visible to a user.**

### Q2 — do the collisions reach the answer? **YES, unflagged**

`graph_callers("has")` returns **25 caller rows at `conf=0.90`**, and they are collisions. Verified in
source: `communities.js` has NO function named `has` — the only occurrence is `groups.has(rawId)`, a
**Map method**. `doc-links.js:182` is `buildIndex`, which builds `new Map()` and calls `.has()` on it.

```
OVERCOUNT warning fired : false
"NOT a floor" present   : false
CONFIDENCE footer       : absent entirely
```

## ⛔⛔⛔ AND THE GUARD CANNOT FIRE HERE, BY CONSTRUCTION

`graph_callers` carries an overcount warning written *because of this exact symbol* — the recorded
incident is `graph_callers("has")` returning 100 callers that were nearly all `Map.has()`. Its
trigger:

```js
const suspicious = (trust === 'weak' && resultCount < 10)
  || (occurrences >= 3 && resultCount < occurrences);
```

Measured: **exactly ONE node in the graph is labelled `has`.** So `occurrences = 1`, the second clause
is dead, and the first needs *fewer than 10* results while this returns 25+.

⇒ **The trigger encodes the wrong failure mode.** It fires on AMBIGUITY — many same-named symbols,
few results — but the collision here is the opposite shape: **ONE symbol absorbing hundreds of
spurious inbound edges from a builtin method name.** The guard is structurally incapable of firing on
the case it was written for.

⭐ Same shape as `instrument-vs-motivating-case`: *the hazard scanner missed the defect it was built
from.* Second recorded instance, on a different surface.

## Against the decision rule

The preregistered branch was: *recovered callers appear AND `has`/`dir` return mostly junk ⇒ a real
trade reaches the user; check whether the overcount warning fires.* **It does not, and it cannot.**

⇒ **This is now the highest-value fix available, and it is small:** the suspicious heuristic needs a
clause for the one-symbol-many-inbound shape — a short leaf name with fan-in far above its own file's
plausible callers is the signature. ⚠ It must be designed so it does not fire on a genuinely popular
internal helper, or it becomes the always-on caveat this repo has already had to tear out once.

## Claim ceiling

⛔ Four symbols, one repository, one graph state. A spot check proving the effect is VISIBLE, never a
rate. ⛔ One-sided: the drifted graph is gone, so no before/after comparison of ANSWERS exists.
⛔ `dir` returned only 3 rows and hit the class-rollup path, so it is reported but not graded.
