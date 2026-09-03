# graph_explain_diff under-counts blast radius, and my reason for excluding it was wrong

**Date:** 2026-09-03
**Probe:** `scripts/probe-explain-diff-uncommitted.mjs`
**Status:** REAL GAP, three controls passing.

## What I claimed last cycle

I wired the uncommitted-mention disclosure across six of eight `buildTrustLine` consumers and left
`graph_explain_diff` out with:

> no single queried symbol to key the relevance gate on

and marked it OPEN rather than settled — because the cycle before, I had excluded
`graph_change_plan` on an estimate of effort and been wrong.

## What the measurement says

| control | result |
|---|---|
| C3 clean tree carries no clause | PASS |
| **C1 the verb DOES enumerate affected callers** | **PASS** — `by_file: [{file: "src/caller1.js", affected_symbols: ["committedCaller"]}]` |
| C2 the uncommitted caller is genuinely missing | PASS |
| **Q2 the result discloses the uncommitted file** | **FAIL** |

⇒ **The verb enumerates the callers of the changed symbols and omits an uncommitted one silently.**
An agent reading blast radius before a change under-counts it, on the verb whose entire job is to
say what a change will break.

⭐ **And "no single symbol" was wrong in a specific, checkable way.** The result carries
`changed.files_with_symbols` — the changed symbols are right there, named. There is no single
QUERIED symbol, which is what I actually observed; but the gate does not need one, it needs a set to
key on, and the set exists. **I generalised from the shape of the ARGUMENT to the absence of the
data.**

## ⛔ The probe's first run was void, and its verdict looked responsible

The first execution fired the abandon rule and printed "C1 failed — the verb does not enumerate
callers, so the honest disposition is EXCLUDED ON AN ARGUMENT". That was an artifact:
`graphExplainDiff` returns a **structured object** which the server JSON-stringifies
(`explain_diff.js:346`), and I had wrapped it in `String()`, collapsing every field to
`[object Object]` so every regex tested that literal.

⚠ The false verdict was the *conservative* one — it would have closed the question in favour of doing
nothing, and it agreed with what I already believed. **A broken instrument that confirms your prior
is the hardest kind to notice**, and the only reason this one surfaced is that `[object Object]`
is visibly wrong in a way a plausible number would not have been.

## Ceiling

One repo, one language, one diff shape (`HEAD~1..HEAD`, a signature change). Measures
`graph_explain_diff` only.
