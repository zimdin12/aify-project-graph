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

---

## ⛔ RESULT, 2026-09-06 — H1's DIRECTION HOLDS. H1's MAGNITUDE DOES NOT, SO THE MECHANISM IS UNRESOLVED.

Digest edge counts, all from the same instrument, on essentially the same tree:

| commit | how it was indexed | symbols | digest edges |
|---|---|---|---|
| `8e29b5ce` | ordinary operation | 3220 | 5382 |
| `03ee4046` | ordinary operation | 3220 | 5352 |
| `4bd6dc86` | ordinary operation | 3227 | 5370 |
| **`fca4ab53`** | **forced full rebuild** | **3227** | **6625** |
| **`fca4ab53`** | **forced full rebuild, repeated** | **3227** | **6625** |

⇒ **The forced full rebuild is reproducible at 6,625 (n=2, byte-identical), and it holds ~1,255 more
symbol-to-symbol edges than the rebuilds that ran during ordinary operation. That is +23%.**

`fca4ab53` differs from `4bd6dc86` by one MARKDOWN file — this preregistration. A document cannot
create 1,255 code edges, so the difference is the rebuild path, not the tree.

### Against the decision rule

The rule said **≥ 5375 ⇒ H1**, and 6,625 clears it. But H1 predicted a return of about **30** edges
and the observed effect is **forty times that**. ⇒ **The DIRECTION is confirmed and the MECHANISM
named in H1 is not.** Reporting this as "H1 confirmed" would be taking a rule written for a small
effect and using it to certify a large one whose cause I have not established.

### One mechanism tested and REFUTED in the same pass

The first rebuild log read *"salvaged 1401 LSP-verified edge(s)"*, which is close enough to 1,255 to
be the obvious suspect. It is not the cause:

```
distinct symbol->symbol pairs, ALL provenance       : 6656
                              excluding LSP_VERIFIED: 6606
                              ONLY  LSP_VERIFIED    :   50
```

⇒ The trust spine accounts for about **50** of these pairs, not 1,255. **The gap is in ordinary
EXTRACTED/AMBIGUOUS edges**, and the near-coincidence of 1401 and 1255 was exactly the kind of number
that invites the wrong noun.

### Why this matters more than the feature that found it

The direction is **fail-open**: the graph reports FEWER edges than a full rebuild finds, which means
fewer callers than exist. That is the dominant defect class this repository has recorded all arc, and
it attacks the only differentiator the product has.

⚠ **And the existing guard does not cover it.**
`tests/unit/freshness/incremental-equals-rebuild.test.js` asserts exactly this property — *"incremental
edges must equal rebuild edges"* — and passes. It builds a synthetic repository and asserts
`nodes.length > 5`. **A control vouches only for the population it counted**, and that population is
several thousand times smaller than the one where the divergence appears.

### What is NOT established, and must not be written down as if it were

- **That the ordinary-operation rebuilds were incremental.** That is inferred from context, not read
  from a log. The honest statement is *whatever the normal path does yields ~19% fewer edges than
  `force:true`*, which is the operationally relevant comparison either way.
- **Which files or relations account for the 1,255.** Unmeasured.
- **Whether this affects any shipped verb's answers.** Plausible and untested. `graph_callers` reads
  the same edges, so an under-populated graph would under-report callers — but that is a prediction,
  not a measurement.

⇒ **Follow-up, ranked:** (1) name the missing edges by relation and file, (2) reproduce on a second
repository, (3) then decide whether the guard's fixture or the rebuild path is what needs to change.

## Claim ceiling

⛔ One repository, two rebuilds, one observation. If H1 holds this is a reproduction target, not a
measured rate. ⛔ And 30 edges of 5,382 is 0.56%; the significance is the DIRECTION (silent loss),
never the magnitude.
