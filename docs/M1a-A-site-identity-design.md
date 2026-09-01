# M1a step A — symbol-site identity

Repair, not rendering. Settled by M0b (`docs/evidence/identity-qualification/FINDING.md`) and
review's ruling. This document covers **step A only**: make extraction lossless. Steps B (resolved
scope), C (proven equivalence + linkage) and D (grouping/rendering) are out of scope and are named
here only where step A must avoid pre-empting them.

## The defect being repaired

`makeBaseNode` mints `stableId([type, filePath, qname])`, `symbolsById` deduplicates before
storage, and `nodes.id` is the sole primary key with `upsertNode` overwriting on conflict. `qname`
carries no signature and no resolved scope. Measured consequences on a 3-file hostile fixture:

- two same-name overloads in one file collapse to one node (disclosed via `overload_signatures`);
- **two classes sharing a leaf name in different namespaces: the second and its methods are
  deleted, with nothing recording it** — the disclosure only fires when signatures *differ*, and
  identical signatures are exactly the collision case;
- a declaration and its definition land on two different keys, because `qname` embeds a per-file
  module label in one and a bare class label in the other.

Proven by contrast, not inferred: renaming only the second class takes the corpus from 14 to 17
nodes, so the parser saw those symbols in both runs and identity discarded them.

## What step A is, and is not

**Is:** one id per *extracted occurrence*. A declaration site and a definition site are two sites
and stay two rows. Two overloads are two sites. The colliding `beta::Widget` is a site of its own.

**Is not:** any statement that two sites are the same symbol. Step A must be able to represent the
decl/def pair without asserting the pair — the assertion is step C's, under a stated equivalence
authority. A step-A id that implied equivalence would be the same overreach in a new key.

⛔ **Explicitly rejected: changing `stableId` to scope+signature and merging decl with def.** The
node row owns exactly one `file_path`/`start_line`/`end_line`, so that merge is last-writer-wins —
a *new* falsehood traded for the old one. I proposed it; review rejected it; it is recorded here so
it is not reproposed.

⛔ **Also rejected: raw signature as a semantic key.** Declaration and definition spelling,
parameter names and defaults, qualifiers, templates and aliases all differ legitimately.

## Contract

⚠ **AMENDED ON REVIEW.** My draft asked whether site kind should be a hash input or a sibling
column. Ruling: **sibling row field, never a hash input.** Declaration-vs-definition is an
*extractor classification*, not the occurrence's address. Hashing it means that improving the
classification on identical bytes remints the site, so a semantic correction shows up downstream as
delete + add. Collision freedom must come from the occurrence's address, not from a claim about
the occurrence.

```
codeSymbolSiteId(schemaVersion, language, normalizedRepoRelativePath,
                 startByte, endByte, localEmitterSlot)
```

**Byte offsets, not line/column.** `localEmitterSlot` exists only for an extractor that emits
several symbols from one exact AST span, and must be local to that span — never a traversal or
global ordinal, which would make identity depend on visit order.

Alongside it, a **required** row field `site_kind`, typed:
`declaration | definition | declaration_definition | unknown`. It is never inferred later from node
type or range, `unknown` is a valid value, and **absence is not silently "definition"**.

`qname`, `signature`, resolved scope, linkage and any semantic symbol key are metadata and step-B/C
inputs. **None of them are site-ID inputs.**

| property | required | why |
|---|---|---|
| **lossless** | yes | no extracted site may disappear because another shares a leaf, qname or signature. This is step A's whole purpose |
| **site-kind reported** | yes | as a sibling field on the row, typed, with `unknown` permitted |
| **deterministic** | yes | identical bytes **at the same canonical repo-relative path, under the same site-ID scheme version** mint the same ids |
| **stable across line-moving edits** | **no** | not required — reindex atomically remints every dependent edge. Requiring it pushes the design back toward name-based keys |
| **implies equivalence** | **must not** | step C's job, under a stated authority |

⚠ **Determinism is path-relative by construction.** An earlier wording ("deterministic for identical
bytes") is false across two files, because path is deliberately an input. Path normalisation and
case policy must be specified: **Windows aliases must not mint two site ids for one tracked path.**

⛔ **Overload is NOT a site kind.** Two overloads are two occurrence rows, told apart by their site
ids and declarator metadata. Listing `overload` beside `declaration`/`definition` would conflate an
*inter-site relationship* with a *site role* — and the relationship is step C's to assert.

### Implementation guard

The generic extractor has the matched AST `node` in hand, but `makeBaseNode` receives only line
ranges. **Step A must transport exact byte start/end (and the local emitter slot) into the
builder.** Deriving them from line fields recreates collisions for multiple declarations on one
line — the same defect in a new place.

## Scoping the change

Four separate `stableId` definitions exist (`ingest/extractors/generic.js`, `ingest/sweep.js`,
`ingest/frameworks/laravel.js`, `ingest/frameworks/_plugin_utils.js`), all sha1 over
`parts.join('::')`. That is how "scoped to code symbol sites" gets violated silently.

The fix is **domain-named builders**, not one universal helper: `codeSymbolSiteId` for code
symbols; File, Module and framework ids keep their current owners unchanged. Differential tests
must prove only code symbol-site ids move and **every other id population is byte-identical**.

## Regeneration — deliberately not a remap

⚠ **AMENDED ON REVIEW.** I wrote this section as an old→new id remap. That promises a mechanism we
should not build: a forced full reindex **regenerates** nodes, edges, unresolved refs and FTS from
source inside one publication generation. There is no old→new mapping to apply, and inventing one
would let `dirty-edges.full.json`'s **eight already-stale ids** be laundered through a guess and
emerge looking successfully migrated.

"Remap" is reserved for a persisted external consumer whose old id must retain continuity. **None
has been established.**

Versioned, with a forced full reindex. Old and new identities must not coexist under one attested
generation.

Regenerated from source (`docs/evidence/identity-qualification/ID-CONSUMER-AUDIT.md`):

- `edges` — both endpoints, 20,194 rows, 100% resolving
- `unresolved_refs` — both endpoints **by schema contract**; `to_id` is currently 0-of-37,261
  non-null, which is a typed population-zero and **not** permission to skip the column
- `nodes_fts` and its four shadow tables

Sidecars — `dirty-edges.full.json` (2,815 ids) and `manifest.json` (37) — are **regenerated from
that generation, or explicitly invalidated and refused**. Never translated.

Untouched: `code_intel_records` (182,594 rows — `symbol_id` is a different namespace),
`structural_fingerprints` (keyed on `file_path`), `brief.*.md` (labels and paths only), overlay
anchors (symbol spellings and globs, no ids).

⚠ Consumers no schema census can see, still owed before code changes: the resolver's in-memory id
use (transient only — joins and `seen` sets), dashboard payloads (built per request, never
persisted), and code-intel's promotion/join behaviour (`resolveDefinedSymbolNode` locates nodes by
file/span and falls back to a synthesized Symbol — behaviour to audit, not rows).

## Acceptance — kill the observed failures, not the headline

Every one of these is a measured failure from M0b, not a hypothetical:

1. both namespace-twin classes retained, and both their methods;
2. overload sites distinct;
3. header and implementation sites **both retained**, and linked only where equivalence is proven
   (step C) — retention alone is step A's bar;
4. repeated `extern` sites retained;
5. `static` and anonymous-namespace twins: **both occurrence rows survive**. ⚠ Amended on review —
   my draft demanded separation "by modelled linkage", which is step C's and cannot be step A's
   bar. Step A's bar is survival, and the preregistered check is a **mutant that erases the
   accidental `qname` distinction while preserving loci**: both site rows must remain. Step C later
   proves they are distinct semantic entities *because linkage is internal*;
6. operators, templates and qualifiers covered;
7. **the collision-rename mutant loses its 14 → 17 delta** — the sharpest single check, because it
   is the exact contrast that proved the defect;
8. no dangling or old-id edges after rebuild;
9. **zero merge metadata in the rebuilt graph** — `overload_signatures` population 0, `overloads`
   population 0, every overload occurrence its own row with its own `extra.signature`. A weaker
   predicate ("no `overload_signatures` without `overloads`") would still permit the disclosed
   two-signature merge, which is the old lossy model with better metadata. Merge metadata surviving
   step A **is** evidence the repair failed.

Once item 9 holds and the schema gate forces old graphs to rebuild, `mergesOverloads`, the
self-edge downgrade branch, and the callee renderer's "ONE node merging N overloads" note are
**deleted**, not retained as unreachable compatibility code — see
`docs/evidence/identity-qualification/PRODUCTION-FALSE-EDGE.md`.

⛔ **P2 is not step A's to claim.** Free-function header declarations produce no node at all today —
that is an extraction omission, not an identity defect, and identity repair may not report it as
fixed.

## What this design does not establish

Nothing here is measured yet; this is a design against measured defects. The C++ prevalence
question stays open and belongs to M5, which must state its own prevalence noun. The 50-row
retrieval cap remains unqualified — no population reached it.
