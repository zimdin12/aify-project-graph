# Preregistered: did an incremental rebuild drop 32 edges, or did the code?

**Written 2026-09-06, before the measurement exists.** The delta surfaced this within minutes of
being wired, which is the first time this project has had an instrument that could.

## The observation

`deltaFromPrevious` on the live database, `8e29b5ce -> 03ee4046`:

```
symbols +/- : 0 / 0
edges   +/- : 2 / 32
fanInMoved  : 12
crossLayer  : 0
top moves   : orchestrator.ensureFresh 5->0
              publication-schema.bumpGraphGeneration 4->1
              publication-schema.classifyAttestation 5->1
              publication-schema.classifyPublication 3->0
              publication-schema.ensurePublicationTables 4->2
```

⚠ **Those two commits changed ONE source file** (`structural-digest-store.js`, adding a retention
constant and a prune) plus its test. Nothing in that diff plausibly removes 32 edges, and nothing in
it touches `orchestrator.ensureFresh`, whose fan-in went to zero.

## What is already ruled out

**The capture is not nondeterministic.** That was the first hypothesis, because
`captureStructuralDigest` collapses duplicate qnames to a first occurrence and SQLite row order is
unspecified. Two captures from the same unchanged graph, in one pass:

```
symbols a/b : 3220 3220
edges   a/b : 5352 5352
IDENTICAL   : true
```

⇒ The digest is a faithful reading. Any difference between the two stored digests is a difference in
the GRAPH, not in the instrument. That control is what makes the rest of this measurable.

## The two explanations, and they predict different things

| | Explanation | Prediction for a FORCED FULL rebuild at the current commit |
|---|---|---|
| **H1** | An incremental rebuild re-extracts changed files and loses edges whose source file was not re-extracted | edge count returns to **≈5382** — the ~30 come back |
| **H2** | The edge loss is a real consequence of the committed change | edge count stays at **≈5352** |

**Decision rule, fixed now:**

- **≥ 5375 edges** ⇒ H1. An incremental rebuild silently drops edges, which is a product defect, and
  a serious one: it is the fail-open direction (fewer callers reported than exist).
- **5352 to 5360** ⇒ H2. The drop is attributable to the code and the delta reported it correctly.
- **Anything else** ⇒ neither; report as unresolved rather than forcing it into a box. ⛔ A binary
  check reports the wrong conclusion when reality is neither of its options.

## What makes this measurable at all

`tests/unit/freshness/incremental-equals-rebuild.test.js` already exists, so the project has asserted
this property before. If H1 holds, that test does not cover whatever case this is — which would be
the finding, not the edge count.

## Claim ceiling

⛔ One repository, two rebuilds, one observation. If H1 holds this is a reproduction target, not a
measured rate. ⛔ And 30 edges of 5,382 is 0.56%; the significance is the DIRECTION (silent loss),
never the magnitude.
