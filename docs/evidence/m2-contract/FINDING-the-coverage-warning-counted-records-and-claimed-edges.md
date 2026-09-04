# The coverage warning counted records and claimed edges

`graph_health` is the most-called verb in this arc — 89 calls across every transcript on this
machine, twice the next one — and its top code-intel `nextAction` is the sentence an agent reads
when it wants to know whether an absence can be trusted. Until this commit it read:

> the code-intel collection covers **624 of 854** eligible file(s), so **[lsp✓] evidence exists**
> for part of the repo only — a symbol outside that set gets heuristic answers with no signal
> saying so

Two populations, joined by the word *so*.

| Number | What it counts | Where |
|---|---|---|
| **624** | DISTINCT `file` in `code_intel_records`, across **every live collection ever imported** | `coveredFilePaths`, `collect_code_intel.js:229`; `filesProcessedSource: "all_live_collections"` |
| **31** | DISTINCT `source_file` among edges with `provenance = 'LSP_VERIFIED'` | the only thing `[lsp✓]` can render from |

`[lsp✓]` comes from an edge and from nothing else — `renderer.js:39-42` and `trace.js:255` both
switch on `provenance === 'LSP_VERIFIED'`, and no path under `query/` renders the marker from a
record. So the sentence attached a records figure to an edge claim, and the ratio a reader computes
from it — 624/854, **73%** — described a compiler-verified surface of **31/854, 3.6%**.

## The mechanism, read in code rather than inferred

`importer.js:755-773`: a complete unscoped `ok` collection **DELETES** the prior `LSP_VERIFIED`
edges for its language before importing its own. It does **not** delete their records. Records
therefore outlive the edges they arrived with, and a numerator counted from records keeps counting
files whose verified evidence a later run threw away.

This repository has nine collections and one live spine.

## Measured, with the controls in the same pass

On this repository's graph, 2026-09-04:

```
distinct source_file among LSP_VERIFIED edges                    31
  of those, files OUTSIDE the latest collection's record set      0   <- the preregistered falsifier
  [POSITIVE CONTROL] of those, files INSIDE it                   31   <- membership test can say yes
distinct record files across all live collections               640  (624 after the corpus filter)
graph_health coverage.filesProcessed / filesEligible        624 / 854
graph_health coverage.filesProcessedLatestCollection             73
```

**The falsifier was written down before the query ran:** if *any* file outside the latest collection
still carried a live verified edge, the union numerator would be tracking the verified surface and
this finding would be dead. Zero did. The positive control establishes that the membership test can
return both answers, so the zero is a fact about the graph rather than about the instrument.

## What is NOT wrong

⚠ **The union numerator is not the defect and has not changed.** `filesProcessed` moved from the
latest collection to all live collections to fix the opposite failure — a 3-file targeted collect
reporting "3 of 557" as though the repo were 0.5% covered. That reasoning still holds for the
question it answers, which is a *records* question. What changed is that the `[lsp✓]` claim now
carries an edge-derived count instead of borrowing this one.

⚠ **The sibling surface was right, and I had it backwards.** The `LSP SCOPE:` clause on every
absence answer says "the newest code-intel collection is typescript, which processed 73 of 627
eligible files". Last night's handoff recorded this as a six-fold *understatement* to be corrected.
It is not. After a complete run the newest collection **is** the live verified spine, so 73 is the
right noun; after a partial run prior edges survive and the clause understates — which fails
**closed**. Only `graph_health` failed open, so only `graph_health` changed.

## The fix

`codeIntel.lspVerifiedFiles` is read from the same handle and the same instant as
`lspVerifiedEdges`, and the sentence now reads:

> code-intel records cover 624 of 854 eligible file(s), but live [lsp✓] edges reach only 31 files —
> a later complete collection deletes earlier verified edges and keeps their records, so the record
> count OVERSTATES the compiler-verified surface; a symbol outside it gets heuristic answers with no
> signal saying so

An unreadable count renders `how many files live [lsp✓] edges reach is UNKNOWN` rather than
silently restoring the old reading.

## Claim ceiling

⛔ **This is one repository's graph.** The 20× gap between the two populations is a fact about a
repo with nine collections and one complete run. A repo with a single collection has no gap at all,
and the sentence there says the same number twice.

⛔ **`lspVerifiedFiles` counts files that carry a verified edge, which is not the same as files
clangd looked at.** A file processed by the collection with no resolvable calls in it produces zero
verified edges and is honestly compiler-covered. So the new number **understates the verified
scope** — deliberately, because a warning that errs must err toward less trust, and because there is
no stored fact naming which collections still own live edges. Naming it "edges reach N files" rather
than "N files are covered" is what keeps that honest.

⚠ **Not investigated:** whether `absenceAuthority` should require verified-file coverage as well as
`coverage.complete`. It currently takes `compilerVerifiedEdges` as a count, and the same
edges-vs-records question may apply one layer down.

## Who this fix helps, and the consumer it can never help

Put to an outside reviewer briefed to argue the target was wrong. Their answer sharpened the
existing "transitivity and virtual dispatch survive, safe-to-delete does not" from a list into a
reason, and the reason is worth keeping because it says the limit is **permanent, not pending**:

- **"Safe to delete" is a universally-quantified ABSENCE claim.** It needs completeness, and no
  coverage number this instrument can ever produce reaches it — `LSP_VERIFIED` edges accumulate from
  what was actively touched, never from a guaranteed sweep. Going from 624/854 to 31/854 does not
  change that answer; it makes the true answer, *this cannot license deletion*, visible instead of
  hidden behind an inflated denominator. Same fact as our own `index_population_unattested` being
  true of **every** call.
- **Transitivity and virtual dispatch are EXISTENCE claims.** "A calls B calls C", "these N types
  override this method" can be true and useful from partial coverage, provided the specific edges
  are inside the covered set. There an honest coverage number is a real improvement: it tells the
  caller how much *more* might exist outside what was found, which calibrates confidence instead of
  manufacturing it.

⇒ **This fix helps exactly the consumers whose claims are bounded by what was FOUND, and does
nothing for the one consumer whose claim needs what was NOT found — and no refinement of this metric
will ever change that second half.** That belongs in the pitch as a stated limit rather than a
roadmap item.
