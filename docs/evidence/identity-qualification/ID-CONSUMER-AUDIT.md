# M1a — who actually consumes a node id

Review's ruling made an ID migration the repair and named the consumers to audit: edge endpoints,
resolver, code-intel joins, FTS, fingerprints, sidecars, dashboard, briefs/overlays/anchors. This
is that audit, measured against the live graph at `.aify-graph/graph.sqlite` (6,072 nodes) rather
than enumerated from memory.

⚠ **This is a consumer census, not a completeness proof.** It says what these tables hold and how
they join. It cannot prove no other reader exists — that claim needs the reference resolver, not a
schema read, and it is not made here.

## Measured join rates

| table | rows | id-bearing columns | resolve to `nodes.id` |
|---|---|---|---|
| `nodes` | 6,072 | `id` (PK) | — |
| `edges` | 20,194 | `from_id`, `to_id` | **20,194 / 20,194 (100%)** |
| `unresolved_refs` | 37,261 | `from_id`, `to_id` | `from_id` **37,261 / 37,261**; `to_id` **0 non-null** |
| `code_intel_records` | 182,594 | `symbol_id` (172,468 non-null) | **0** |
| `nodes_fts` + 4 shadow tables | 6,072 | `id` | mirrors `nodes` |
| `structural_fingerprints` | 307 | none — keyed `file_path` | not an id consumer |
| `code_intel_collections` | 9 | `collection_id` | own namespace |
| `graph_generation` | 1 | `id` | own namespace |

**Controls, same pass.** Negative: a fabricated id (`not_a_real_node_id_m1a`) returns 0 rows, so the
join can say ABSENT. Positive: `edges` and `unresolved_refs` resolve at 100%, so it can say PRESENT.
The zero below therefore is a real zero, not a broken join.

## The zero that changes the migration's size

`code_intel_records.symbol_id` is **not a graph node id.** 172,468 non-null values, none of which
resolve. Sampled, they are loci:

```
symbol_id : _dash.mjs:3:7      _dash.mjs:4:34     _dash.mjs:4:38
nodes.id  : f15928052c43cfab97874d41823494b43743d207   (sha1 hex)
```

Two different namespaces. **182,594 rows — the largest table in the graph — do not need remapping**,
which is most of the volume the migration looked like it owned.

## ⛔ CORRECTED — `symbol_id` is a NEGATIVE precedent, not a site identity

I first read `symbol_id` as an occurrence/site identity we already own — file plus locus, one row
per site — and proposed generalising it. **That was wrong**, and review's correction is verified at
the source it cites (`ingest/code-intel/importer.js:785-791`):

> "A clangd symbol typically yields TWO records for the same symbolId: a `symbol` record at the
> .cpp definition body ... and a `definition` record at the .h declaration"

So one `symbol_id` **groups a declaration and a definition**. It is a collection/query handle
anchored at a locus, not one row per source site — it can group multiple sites while failing to
identify any of them independently. Reusing it would rebuild the exact decl/def conflation M0b was
run to reject. The table's autoincrement `id` is its row identity; `symbol_id` is a separate,
unstable grouping namespace.

Read as a **negative** precedent it still earns its place here:

- different namespace from `nodes.id`, so **no bulk remap** — that finding stands;
- coordinates can address a record, but are not stable across edits and carry no site kind or
  declarator shape;
- multiple sites may share one `symbol_id`;
- the importer's fallback `lspSymbolNodeId(symbolId)` can itself synthesize a single-site graph
  row — another last-writer/single-location seam, and one for step C to audit, not step A to copy.

⚠ And `code_intel_records` needing no row rewriting does **not** make code-intel a non-consumer:
its promotion/join paths (`resolveDefinedSymbolNode` locates nodes by file/span, falling back to a
synthesized Symbol) consume the site layer that step A changes. **Behaviour to audit, not rows.**

## Sidecars — the consumers a schema census cannot see

Review named sidecars for a reason: node ids also live in files under `.aify-graph/`, and a
40-hex sha1 there is **shape-indistinguishable from a commit hash**. So membership was resolved
against the real id set rather than assumed from the pattern.

| sidecar | distinct 40-hex | actually node ids |
|---|---|---|
| `dirty-edges.full.json` (11.4 MB) | 2,823 | **2,815 (99.7%)** |
| `manifest.json` | 38 | **37 (97.4%)** |
| `brief.json` | 1 | 0 |
| `refactor-guard-baseline.json` | 1 | 0 |
| `unresolved-categorization.json` | 1 | 0 |
| `structural-fp.json`, `doc-link-misses.json`, `last-refresh.json` | 0 | 0 |

Negative control: a fabricated 40-hex string is not a node id. The three files holding exactly one
non-matching hex are carrying **commit** sha1s — had the pattern alone been trusted, all three
would have been filed as id consumers and remapped, corrupting them.

The four `brief.*.md` artifacts contain **no** node ids at all: they render labels and paths, so the
migration does not reach them.

⚠ 8 of `dirty-edges.full.json`'s 2,823 ids do **not** resolve. That is pre-existing staleness —
ids for nodes that no longer exist — and it is small, but it means the sidecar is already not in
lockstep with the graph, which a migration must not silently inherit as "successfully remapped".

## `unresolved_refs.to_id` is a typed population-zero, not an absence

My first receipt reported only `from_id` and let `to_id` pass silently. Measured separately, with
the `from_id` positive control passing in the same query: **0 of 37,261 rows have a non-null
`to_id`.** That is an empty column in this snapshot, **not** evidence the column is irrelevant —
the migration owns both endpoints by schema contract, and a snapshot where the column happens to
be empty is exactly the population that would let a broken remap ship green.

## Overlay anchors do not key on node ids

`functionality.json` anchors are **symbol spellings, file globs, routes and doc paths**
(`overlay/loader.js:21-26`) — e.g. `"authenticate"`, `"User.__init__"`, `"src/auth/*"`. No node
ids, so the migration cannot break them by remapping. ⚠ But step B changes **resolved scope**, and
a symbol anchor resolves by name — so an anchor's resolution can change even though nothing it
stores was touched. That belongs to step B's acceptance, not step A's.

(This repo has no `functionality.json`, so the claim is read from the loader's contract and its
documented schema, not from live data.)

## What this leaves the migration owning

Node ids are consumed by `edges` (both endpoints), `unresolved_refs` (both endpoints by contract,
`to_id` currently unpopulated), the FTS mirror, and two sidecars — `dirty-edges.full.json`
(2,815 ids) and `manifest.json` (37). Code-intel needs no row rewriting but its promotion/join
behaviour is a consumer of the site layer.

### The code readers, audited by reading them

- **Resolver** (`ingest/resolver.js`) — ids appear only in joins and transient `seen`/`visited`
  sets (lines 316, 359, 483, 575, 777). Nothing persisted, so a consistent remint within one
  generation is enough.
- **Dashboard** (`dashboard/server.js`) — builds prefixed handles (`code:${id}`, `feature:${id}`)
  **at request time** and serves them over HTTP; it writes none of them to disk. A reindex plus a
  page reload regenerates the lot. The only exposure is a browser session still holding pre-remint
  handles, which is a stale-view problem, not data corruption.
- **Code-intel promotion** — `resolveDefinedSymbolNode` locates nodes by file/span and falls back
  to a synthesized Symbol. No rows to rewrite, but its **behaviour** consumes the site layer step A
  changes. Audit for step C.

Still owed and deliberately not claimed: this is what reading these files shows. It is not an
exhaustive reachability result, which would need the reference resolver rather than a read.
