# A gate on creation is not a gate on the edge

2026-08-26. Found by measuring the live graph with no hypothesis, after two arcs had been declared
closed and every remaining item was human-gated.

## The defect

Two guards already refused to **create** an External node from a parse fragment (`entries()]`,
`execFileSync('git',`) or from a word the language reserves (`new`, `catch`). Both live in
`shouldMaterializeExternal`, and `resolveRefs` reaches that function only when `resolveTarget`
returned nothing.

`buildResolvers(db)` queries the `nodes` table with **no type restriction**. So `findByLabel` returns
External nodes that are already in the graph — including every fragment created before the guards
existed. When a ref matched one, an edge was made and the guard was never consulted.

The consequence is worse than "the fix has a hole". The residue was **self-perpetuating**: each
re-index of a file that had once produced a fragment re-attached to it, which refreshed its edges,
which kept `cleanupOrphanExternalNodes` from ever collecting it. A fragment was *stickier than a
legitimate node*.

## Evidence

**Live graph, before the fix**, using the production predicate rather than a re-typed regex, with
controls in the same pass (`isImpossibleExternalTarget` rejects `execFileSync('git',` and accepts
`readFileSync`):

| Population | Count |
|---|---|
| External nodes | 1,104 |
| …impossible as a target | 336 (30.4%) — 334 parse fragments, 2 reserved words |
| Edges pointing at one | 738 of 19,872 (3.7%) — **all CALLS** |

Top offenders by label: `execFileSync('git',` (59), `slice(0,` (35), `map((_,` (25), `[` (23),
`new` (94), `catch` (6).

**A/B through the real pipeline**, satisfying the three-confound checklist — same throwaway repo,
same `ensureFresh` path, resolver the only variable, and a liveness check proving the file was
actually re-processed in both arms:

| Arm | fragment edges | fragment node | control external | re-indexed? |
|---|---|---|---|---|
| HEAD (no re-bind gate) | **1 — survived** | 1 | 0 (drained) | yes |
| With the gate | **0 — drained** | 0 | 0 (drained) | yes |

The HEAD row is the defect in one line: the fragment survived the re-index while a legitimate
unreferenced External did not.

## The fix

One predicate, `isImpossibleExternalTarget(label, language)`, called on **both** paths.

The split is the point. `isPlausibleExternalName` and `isReservedCallee` are **truths about the
label** — `entries()]` is not a symbol, `new` is not a callee in JavaScript — and they hold no matter
how the edge arose. `COMMON_NAMES` and the per-relation rules are a different kind of statement: a
node is not *worth creating*, which is only ever a question at creation time. Only the truths were
moved to the re-binding path.

Three mutants killed, each with the mutation confirmed applied before the run: gate removed, language
ignored, reserved-word half dropped.

## A correction this forced

`graph_health`'s `stale-externals` verdict said *"Incremental reindexing does NOT remove them."* That
was true when written and this change makes it false. Corrected in place: they now drain as each
referencing file is re-indexed, and a forced index still clears them all at once. The advice is
unchanged; only the claim about what happens without it was wrong.

## Four instrument failures, none of which reached a published number

Recorded because each produced a confident, wrong-looking answer that a control caught.

1. **A read-only handle.** `openExistingDb` threw `SQLITE_READONLY` on the injection step. Loud, so
   harmless — the only one of the four that announced itself.
2. **A liveness hole.** The first end-to-end probe reported "NOT PROVEN: the fragment survived". Both
   arms were unchanged, which is the tell: `ensureFresh` had never re-processed the file. A run that
   does nothing is indistinguishable from a gate that fails. Adding a liveness assertion (does a
   newly-added symbol exist?) turned the result from a finding into **VOID**.
3. **A cosmetic classification.** The touch that was supposed to trigger the re-index added a
   top-level `const`, which the freshness layer classified as body-only and skipped
   (`"cosmeticSkipped":1, "processedFiles":[]`). A new exported function is structural and does
   trigger it. Worth knowing independently of this defect.
4. **The wrong source shape, and a control that could not fail.** The synthetic file used
   `text.slice(0, 40)`, which resolves cleanly and produces no fragment — so both A/B arms agreed and
   the experiment tested nothing while looking like a clean negative result. The shape that actually
   emits `slice(0,` is a chained call, copied from `mcp/stdio/brief/render.js:270`. In the same run
   the intended control (a legitimate injected External) drained in every arm, because the source
   never references it, so it could not have distinguished anything either.

The pattern across 2, 3 and 4 is one thing: **an experiment that exercises nothing returns the same
shape of answer as an experiment that exercises everything and finds no effect.**

## Also corrected mid-slice

The first version of the test asserted that a seeded COMMON name still re-binds, reasoning from the
design rationale rather than from a run. It failed. `resolveTarget` already declines a label match
for a common name unless it is uniquely in the ref's own file, and an External node (`file_path` `''`)
never is — a stricter rule that predates this change. So the narrowing to label-truths has **no
observable difference today**, and both the code comment and the test now say so instead of implying
a distinction that nothing guards.

## What is not claimed

- This deletes nothing. The 738 edges and 336 nodes drain only as each referencing file is next
  re-indexed, or at once under `graph_index(force=true)`.
- 738 is the count of edges whose `to_id` is a node the predicate rejects. It is not "edges this
  change removes", and it is a figure about this repository's graph on this date, not a rate.

## The third creation path, measured and deliberately not guarded

Closing the re-binding hole raised the obvious next question: what *other* path reaches
`createExternalNode`? There is one, and it consults no gate at all.

- **Source side.** When a symbolic chain has no resolvable owner, `createExternalNode(ref,
  ref.from_target)` runs with no plausibility check on that line.
- **Target side.** `if (symbolicChain || shouldMaterializeExternal(ref))` — the `||` short-circuits,
  so a symbolic chain never reaches the gate.

`SYMBOLIC_CHAIN_RELATIONS` is `PASSES_THROUGH`, `INVOKES`, `CALLS` — not an obscure set.

**Measured before deciding**, with the control that makes the zero readable in the same pass:

| Question | Reading |
|---|---|
| External nodes appearing as the `from_id` of any edge | **0** |
| Impossible External as an edge source | NONE |
| Impossible External as an edge target | CALLS = 716 |
| *Control:* symbolic-chain relations touching any External | CALLS = **5,976** |

The control matters: without it, "zero sources" would be indistinguishable from a relation set nobody
uses. The relations are heavily used — the source-side line simply produced nothing here.

**So: no guard.** The same call already made for the importer's `upsertExternalNode` — reachable,
zero product, no evidence, therefore no speculative hardening. Recorded in a comment at the line so
the next reader neither overlooks it nor hardens a path with no product. A repository whose framework
refs fail to resolve their owner would exercise it, and that note says what to check first.

## The drain, observed in production

Between the measurement that found this defect and the one taken after the fix shipped, on the same
live graph with the same predicate:

| | before `c0dae75` | after |
|---|---|---|
| External nodes impossible as a target | 336 | 329 |
| Edges pointing at one | 738 | 716 |
| …of those, labels containing `(` | 526 | 510 |

Every row in the top-15 by source file is byte-identical across the two readings, so those files
were not re-indexed in the window.

⛔ **Attribution is NOT claimed.** I hold no per-file before-values for the edited files, and the full
suite ran in the same window. The direction is what drain predicts; that is all this shows.

⭐ **The instrument behind these counts was checked afterwards**, because they are all edge counts:
three full indexes of `8f61239` produce byte-identical node and edge sets, with a comparator control.
So the differences above are not extraction noise — though that check covers the tree-sitter path
only, and says nothing about the LSP path. See `docs/2026-08-26-is-an-edge-count-reproducible.md`.
