# Is an edge count reproducible?

2026-08-26, at `8f61239`. Retires an observation I had recorded and deliberately not chased.

## Why it stopped being idle curiosity

Two full indexes of the same commit were once observed to differ by 4 CALLS edges (8,566 vs 8,570).
I wrote it down, marked it unclaimed, and told myself not to chase it without a reason.

The reason arrived: every population and drain figure published this session is an **edge count** —
738, 716, 526, 510. If the indexer is non-deterministic, some part of what I read as drain is noise,
and I would have no way to tell which part. The instrument had to be checked before the numbers it
produced could be trusted.

## Method

Three full indexes, same `repoRoot`, same commit, each into its **own** graph directory (so the live
`.aify-graph` is never touched), then an exact **set-difference** of nodes and edges — not a
comparison of totals. Matching totals can hide two offsetting differences; edge identity cannot.

Each edge was keyed on `from_id, to_id, relation, source_file, source_line, provenance, extractor`;
each node on `id, type, label, file_path, start_line, end_line, language, confidence`.

**Control, in the same pass:** the comparator was fed a set with one edge deliberately removed and
had to report exactly one difference. It did.

## Result

| Arm | seconds | nodes | edges | CALLS |
|---|---|---|---|---|
| a | 44 | 5,307 | 17,559 | 8,573 |
| b | 35 | 5,307 | 17,559 | 8,573 |
| c | 47 | 5,307 | 17,559 | 8,573 |

Set-difference between a and b: **0 edges in A not B, 0 in B not A, 0 nodes either way.**

⇒ **At this commit the extraction path is deterministic**, and the earlier 4-edge discrepancy does
not reproduce. Why it happened then is not established and is not claimed here; the code has changed
since, and I hold no artifact from that run.

## The scope limit, which is half the result

A fresh full index into an empty graph directory produced provenance:

    EXTRACTED 16,035 · AMBIGUOUS 896 · INFERRED 628 · LSP_VERIFIED **0**

while the live graph holds 2,379 `LSP_VERIFIED` edges.

⇒ **This test covers the tree-sitter path and says nothing about the LSP/code-intel path.** If the
old discrepancy came from anywhere, the untested path is the remaining candidate.

## Two claims I nearly made, killed by reading before asserting

**"A forced index silently drops the whole compiler-verified tier."** It was right there in the
numbers — 2,379 edges in the live graph, 0 after a rebuild — and it would have been a serious finding
about advice this repo ships (`graph_health` tells users to run `graph_index(force=true)`). It is
false. A full rebuild re-synthesizes LSP edges from `code_intel_records`, and when the collection's
commit has moved it salvages **per file** against `git diff`, failing closed when the diff cannot be
computed. Already handled, carefully.

**And my own zero was structurally guaranteed.** I indexed into a *fresh* graph directory, which has
no `code_intel_records` to restore from. The measurement could not have produced any other number.
That is the third time this session the same shape has appeared: **a setup that cannot exhibit the
effect returns the same answer as a system that does not have it.** The control that would have
caught it immediately — index into a *copy of the live graph dir* — is the one I did not run, because
the zero agreed with a story I was already forming.

## What is claimed

- **PROVEN:** three full indexes at `8f61239` produce byte-identical node and edge sets, comparator
  control passing, on this repository, on this machine, on this date.
- **NOT COVERED:** the LSP/code-intel path, which contributes zero edges to a fresh graph directory
  by construction.
- **NOT CLAIMED:** any explanation of the original 4-edge difference, and any general statement that
  the indexer is deterministic under conditions other than the three runs above.
