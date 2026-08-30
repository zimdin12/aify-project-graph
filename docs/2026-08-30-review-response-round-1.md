# Review response, round 1 — six of nine fixed

2026-08-30. `graph-senior-dev` reviewed `cee5ac6..71b2a7d` with instructions to falsify, and returned
nine decision-grade findings with executed evidence, then amended with three more. He was right about
all of them. Three were defects **I introduced today**, and one of those was a guard I had written
this morning and deleted this afternoon.

His verdict on the contested reversal: **do not revert the discovery premise.** Explicit `kind:"code"`
stays narrow and the founding questions improve. The premise survived; the implementation did not.

## Fixed in this round

### P0 — a blocker became a positive existence claim (his finding, my regression)

`graph_packet` deliberately bypasses `inspectReadFreshness`, then filed the `GRAPH REBUILD INCOMPLETE`
string from `graph_consequences` into its "any informative string is ambiguity" branch. Reproduced on
an empty graph with `status: indexing`:

    SYMBOL: newSymbol
    STATUS: known to graph; AMBIGUOUS — feature mapping NOT CHECKED

There is no such symbol. **This is the same laundering I fixed in `d17f2a2` and then deleted** when I
removed the marker machinery — the guard went with it. It is now keyed to freshness BLOCKERS rather
than to one marker, and the predicate lives beside the banners it matches so producer and consumer
share one literal. `FRESHNESS_BLOCKER_BANNERS` is exported and the messages are built from it, so the
two cannot drift.

### P0 — atomic crash recovery still assumed the pre-atomic world (his finding, my regression)

The partial-resume path opened with: *"the chunked-commit code has already preserved some nodes in
SQLite. We can resume from that partial state."* That premise died when the rebuild became one
transaction — a killed run now rolls back to the **complete old graph**, and its File rows are not
processed chunks. He executed the consequence:

    recovery log: 1 files already indexed, 0 pending
    result: indexed:true, processedFiles:[]     manifest: still indexing

A repository that can never re-index itself, reporting success. The resume path is **deleted**; a
`status: indexing` manifest now forces a clean rebuild. Verified: 1 file processed, manifest `ok`,
new symbol present.

### P1 — the default widening leaked External stubs (my defect, today)

Automatic widening reused `kind:"all"`, whose filter excludes nothing, so an unresolved-reference stub
won the top slot while the disclosure named a different population:

    graph_search("parameter types", limit=1)
    => NODE external:3a2628cf549384a8 external PARAMETER_TYPES

`kind` is now `auto | code | all`, default `auto` — code plus Document/Directory/Config, **never**
External. This also **deleted** my two-route widening (widen-on-zero plus a prose path): with `auto`
as the real default, documents are simply in the population, and both routes were unnecessary
machinery on top of a wrong default.

### P1 — the declared default was not behaviour-equivalent to omission (my defect, today)

The JSON Schema still declared `kind.default = "code"` while omission had come to mean discovery. Any
AJV or generated client that injects declared defaults would turn an omitted founding query back into
`kind:"code"` and restore NO RESULTS. The declared default is now `auto`, which is exactly what
omission does.

### P0 (amendment) — a safety currency no safety consumer reads is not a gate

`absenceAuthority` was hardened to require a current collection, and then had exactly two production
files: its own definition and `graph_health`. `graph_preflight` — the verb that prints
`DECISION: SAFE … proceed` before someone deletes a symbol — imported neither it nor collection
currency. He executed stale and unknown-currency collections: health denied authority while preflight
said SAFE, its own trust line calling the caller set a FLOOR in the same output.

⛔ **This is the fourth time I have hardened a signal without asking who consumes it.** Preflight now
computes collection currency (reusing the HEAD it already observed, per this repo's one-git-read rule)
and cannot return SAFE when currency is false or unknown. Three tests, including a positive control
that SAFE remains reachable — a gate that always denies is as useless as one that always grants.

### High (amendment) — a failed BEGIN poisoned the manifest (my defect, today)

I wrote the manifest to `indexing` *before* acquiring the transaction, and left `begin()` outside the
guarded block. A BUSY or I/O failure then left the complete old database beside an `indexing`
manifest that nothing would clear — feeding directly into the recovery and stale-serving paths.
Order reversed: acquire first, mark second, both inside the try.

### P2 — rollback reported a clean unwind it had not verified

`rollback()` swallowed every `ROLLBACK` error and marked itself closed regardless, so a transaction
still open would be reported as unwound — the object's state lying about the database's.
`raw.inTransaction` is now the authority; the exception is not, because the commonest exception means
the transaction had already ended on its own.

He also accepted both surviving mutants with their narrow claims, and confirmed independently that
nested `db.transaction()` behaves as a savepoint and the atomicity core holds.

## Still open, and honestly not started

These are design work, not adjustments, and I would rather name them than half-do them:

1. **Snapshot identity.** "Serve the previous snapshot" decides *complete* from `File` count > 0. He
   executed a legacy shape — manifest claiming 2,572 nodes, DB holding one File row — and it was
   served as "the completed previous snapshot". Needs a DB generation row written inside the rebuild
   transaction and a manifest `completedGeneration`, served only when they match.
2. **Sidecar/manifest convergence.** DB COMMIT → doc sidecar → manifest OK → dirty-edge sidecar. He
   forced the dirty sidecar to fail: manifest said `ok` with a new commit while the full sidecar was
   unavailable, and `readDirtyEdgesSidecar` treats unreadable as `[]`, so the next incremental run
   drops those unresolved refs.
3. **Stale structural fingerprints.** A valid OLD sidecar is trusted for cosmetic classification. His
   probe: `cosmeticSkipped:1`, `processedFiles:[]`, source `shapeA`, DB still `shapeB`. A missing
   sidecar disables the fast path; a stale valid one lies.
4. **Collection union currency.** `coverage.complete` counts records across ALL collections while
   `collectionCurrent` compares HEAD to the LATEST one only, so one small current collection can
   certify a mixed-generation union. Commit equality also ignores dirty working-tree bytes.
5. **Warning transport.** `graph_whereis` misses and `graph_explain_diff` early returns drop
   `prefixReadWarnings`. Preflight is now gated mechanically rather than by warning prose, but the
   other two routes still return without it.

⇒ 1, 2 and 3 share one remedy — a transactionally-bound generation that artifacts carry — which is
why they should be done together rather than patched apart.
