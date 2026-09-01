# FINDING — M1's dead end was still open, under a ✅

## The claim that was checked, and the claim that was made

M1's stop condition names one behaviour:

> graph_callers already refuses a bare ambiguous name, but the refusal is a **DEAD END**; make it
> return the qualified candidates **WITH their caller sets**.

The plan carried a ✅ against it. What that tick was earned by:
`alpha → {alphaCaller}`, `beta → {betaCaller}`, **disjoint** — caller sets proven not to merge when
each candidate is queried **one at a time**. What it was read as: the refusal returns them.

Those are different statements, and only the first was true. The refusal emitted names, locations,
a truncation note and a retry hint. An agent that asked `render` still had to issue one call per
candidate to find out which one it meant — the exact dead end the milestone is named for.

⇒ **A status line is not evidence about behaviour.** This is the sixth mis-scoped written status
corrected in this arc, and the first where the wrong claim sat under a green tick rather than a
stale one.

## What shipped

`76675ef`, hardened by `a8d92a7`. One owner for "who calls this node"
(`mcp/stdio/query/candidate-callers.js`), which also collapsed a duplicate of that query living in
`preflight.js` and `callers.js`.

Measured on this repo's real graph — **the positive control, because two fixture symbols with zero
callers cannot distinguish "enrichment works" from "enrichment always says zero"**:

```
AMBIGUOUS MATCH for "graphDir". 2 concrete candidates found:
- …brief-detects-a-mid-read-rebuild::test::graphDir tests/unit/brief/…:62
    -> 4 callers: snapshotArtifacts, removeArtifacts, publishedGeneration (+1 more)
- …health-trust-basis-comes-from-the-capture::test::graphDir tests/unit/query/…:24
    -> 16 callers: dbPath, divergeTableFromManifest, setupRepo (+13 more)
```

Bounded on both axes M1b's own bullet requires — at most `limit` candidates, at most three names
each — so a high-cardinality name narrows rather than "multiplying N x 100 edge fetches into an
output wall".

## ⭐⭐⭐ Mutant E-7 found a fail-open defect in my own design

`E-7` made enrichment always-on for all six verbs (`callerSetsFrom || true`) and **SURVIVED**.

The reason is the interesting part: with no db handle every lookup threw, a `catch` swallowed it,
and the output came out **byte-identical to the opt-out path**. No test could separate *"did not
ask"* from *"asked and failed"*.

The production consequence is worse than the testing one. A refactor that broke the query would
silently drop caller sets from every refusal, and a missing `->` line reads exactly like *"this
symbol has no callers"* — an absence claim manufactured by a swallowed error.

⇒ The listing still survives a failed lookup, but now **says so**, and names the misreading it would
otherwise invite. E-7 is now KILLED.

⚠ E-7 first came back `NOT APPLIED 0 matches` on the re-run, because the fix moved its anchor.
That verdict is **unverified, never passing** — it was re-anchored and re-run before being recorded.

## Mutants — 8 run, 8 killed

cap-as-total, bare "no callers", dropped `+N more`, enrichment disabled, dropped FLOOR caveat,
unconditional zero clause, opt-in leak (E-7), and **the consumer half** — `graph_callers` no longer
passing the handle. That last one exists because a mutant deleting `structural_coverage` from
`graph_consequences` survived earlier in this arc: testing a helper proves nothing about the verb
meant to call it.

## Claim ceiling

- This changes **`graph_callers`'s refusal only**. `graph_preflight` refuses through the same
  builder and still returns a dead end; that is untouched and stated, not fixed.
- "Better for an agent" here means **one call instead of N**. No A/B was run, and none is claimed —
  by the plan's own rule that is M5's job.
- The caller counts are heuristic-graph counts, a FLOOR. Nothing here makes an absence trustworthy;
  it makes the absence *scoped* and says which index it is about.
