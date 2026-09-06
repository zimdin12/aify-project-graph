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

---

## ✅ FOLLOW-UP 1 DONE — the missing edges are NAMED, and the LSP suspect is dead for good

Both digests were stored, so the two edge sets were diffed directly rather than reasoned about.

```
ordinary build  4bd6dc86 : 5370 edges
forced  build   fca4ab53 : 6625 edges
MISSING from the ordinary build : 1411        (net +1255, so 156 also went the other way)
distinct source files            : 435
by extension                     : .js 1060, .mjs 351
top sources: analytics.js 28 · graph-shape.js 27 · packet-lists.js 25 · pull.js 21 ·
             packet-overlay.js 19 · find.js 18 · linkage-scope-runner.mjs 17
```

⚠ **1,411 against the rebuild log's "salvaged 1401 LSP-verified edge(s)" is a near match, and it is
noise.** I had already ruled the spine out on aggregates; because a nearly-matching number is the
strongest invitation to the wrong noun, it was re-checked per edge instead of trusted. Every one of
the 1,411 missing pairs was looked up in the forced graph:

```
their provenance in the FORCED graph:
    1405  EXTRACTED
       6  LSP_VERIFIED
```

⇒ **The missing edges are ordinary extracted call edges. The trust spine accounts for six of them.**
The coincidence is dead, twice over, and by two independent measurements.

### What this narrows the mechanism to

The loss is **broad, not localised**: 435 distinct source files, no subsystem dominating, the largest
single file contributing 28 of 1,411. That shape argues for a systematic difference in how references
are resolved between the two rebuild paths, rather than a bug in one extractor or one file type.

⛔ Still NOT established: which resolution step differs. Naming it needs the two paths instrumented,
not more counting.

## Claim ceiling

⛔ One repository, two rebuilds, one observation. If H1 holds this is a reproduction target, not a
measured rate. ⛔ And 30 edges of 5,382 is 0.56%; the significance is the DIRECTION (silent loss),
never the magnitude.

---

## PREREGISTERED, follow-up 2 — does incremental DROP edges, or does a deficit ACCUMULATE?

**Written before the run.** The graph is currently at the forced-rebuild state (6,625 edges). Touch
one source file, let an ORDINARY (non-forced) index run, and capture again.

| | Explanation | Prediction |
|---|---|---|
| **A** | An incremental rebuild actively drops edges it did not re-extract | count falls back toward **~5,400** |
| **B** | The deficit ACCUMULATES over many incremental builds; one does little | count stays **≥ 6,500** |

**Decision rule, fixed now:**

- **≤ 5,800** ⇒ A. One incremental pass destroys most of the gain, which makes this urgent and
  reproducible on demand.
- **≥ 6,500** ⇒ B. The deficit is historical drift, and the remedy is periodic forced rebuilds plus
  a freshness disclosure, not an extraction fix.
- **5,800–6,500** ⇒ partial loss; report the number and do not force it into either box.

⚠ The edit must be a REAL source change, because a no-op edit may be cosmetically skipped and would
measure nothing. A comment-only change to a file with many outgoing edges is the cheapest edit that
still forces re-extraction of that file.

---

## ⛔ RESULT, follow-up 2 — **B**, and the run exposed a defect in the instrument itself

**The planned run produced no data.** An ordinary index at `bd9c90fe` reported `"indexed": true` and
wrote **NO DIGEST ROW**. When the graph is already fresh the rebuild block never executes, and
`captureStructuralDigest` lives inside it. That is finding 2 below.

**The question still resolved, from rows nobody planned.** Digests written *after* the forced rebuild,
by ordinary operation rather than by `force:true`:

| commit | when | edges |
|---|---|---|
| `4bd6dc86` | before the force | 5370 |
| **`fca4ab53`** | **forced** | **6625** |
| `5c51a033` | after, ordinary | 6625 |
| `c43b0a05` | after, ordinary | 6625 |
| `7b621d9d` | after, ordinary | 6625 |

⇒ **≥ 6,500, so B by the preregistered rule.** Once a forced rebuild repairs the graph, ordinary
operation MAINTAINS 6,625. Nothing re-drops the edges on the next build.

**What that changes.** The deficit is **accumulated historical drift**, not active per-build
destruction. The remedy is a periodic forced rebuild plus a freshness disclosure, NOT an extraction
fix — and it is much less urgent than "every build silently loses edges" would have been. ⚠ It is
also still real: a long-lived graph drifts ~19% below what a rebuild finds, in the fail-open
direction, and nothing currently tells anyone.

⚠ **And this retires my own earlier wording.** I wrote that the ordinary-operation rebuilds were
possibly incremental and that the honest phrasing was "whatever the normal path does". Since digests
are only written by the rebuild block, all seven rows came from that same path — so the comparison
was never incremental-versus-full. It was **a graph carrying accumulated drift versus the same graph
after repair.** The direction and the magnitude stand; the label I nearly attached to them does not.

## ⛔ FINDING 2 — SOME INDEX PATHS WRITE NO DIGEST, so the delta has no data on them

`captureStructuralDigest` sits inside the rebuild transaction, which is correct for atomicity and
wrong for coverage: an index that finds the graph already fresh returns early and writes nothing. A
new commit therefore often has NO digest, and `deltaFromPrevious(HEAD)` answers *"no digest stored
for HEAD"* — on the exact question the morning view exists to ask.

⇒ Same shape as every other defect this session: correct on the path it was tested on, absent on the
path a user actually takes. Found within an hour of shipping it, and only by driving the real thing.
