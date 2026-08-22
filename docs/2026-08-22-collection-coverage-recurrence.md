# A 73-of-627 collection reported `ok`, and three of my figures were 91.5% stale

Found by chasing "why does edge derivation keep 4.9%" — a question whose premise turned out to be
mine, not the code's.

## The two defects

    collected_at          mode   proc/scope/elig   refs_found  status
    2026-08-22T05:10:46   null     73/  73/ 627       2204     ok        <- mine, scope:'all'
    2026-08-20T14:11:45   null    154/ 154/ 589       3590     ok
    2026-08-20T14:02:40   null    200/ 200/ 584       5872     partial
    2026-08-20T13:34:25   null    200/ 200/ 583      10706     partial

**① A PARTIAL COLLECTION REPORTED `ok`.** I called `graph_collect_code_intel({ scope: 'all' })` with
a 900-second budget. It processed **73 of 627 eligible files (11.6%)** and recorded `status: ok`.
Note `files_in_scope` is **73, not 627** — the scope itself resolved to 73. Runs that stopped at 200
recorded `partial`; mine stopped at 73 and did not.

**② PRUNE NEVER RAN, SO 91.5% OF THE RECORD TABLE IS STALE.**

    records total                182,594
      in the current collection   15,549
      STALE                      167,045   (91.5%)   across 9 same-provider collections

`pruneSupersededCollections` only prunes on a COMPLETE collect. Since ① never reports complete,
nothing is ever pruned. And the source comment states the consequence exactly:

> *getCodeIntelEvidenceForSymbol/getCodeIntelDiagnosticsForFiles query ACROSS all collections, so
> stale evidence/diagnostics from superseded runs resurface.*

⇒ The hazard was documented at the prune, and the prune's own precondition prevents it firing.

## ⛔ THREE FIGURES I PUBLISHED TODAY, ALL 91.5% STALE

| I reported | across all collections | current collection only |
|---|---|---|
| declarations with code-intel evidence | **97.6%** | **9.8%** |
| file coverage | **624 of 627** | **86 of 627** |
| "the collection is excellent" | — | it collected 11.6% of the repo |

⇒ **RETRACTED.** `coveredFileCount` reads across every collection by design — it is the numerator
for a repo-level claim, and it counted seven superseded runs. I used it, twice, to tell Steven and
`ef-manager` that coverage was 624/627.

## ⚠ THIS IS A RECURRENCE, NOT A NEW DEFECT

`memory/collection-coverage-defect.md`, from an earlier session: *"following graph_health's OWN top
recommendation silenced its only code-intel warning; a 0.6% collection asserted health."*

Same shape, same verb, same failure to check the denominator — this time by the person who wrote
that memory. The earlier fix made `graph_health` report three persisted numbers instead of one; it
did not make a partial collection stop calling itself `ok`.

## What this does NOT establish

⚠ **Why the scope resolved to 73 is not diagnosed.** Budget exhaustion, a batch cap
(`maxBatchFiles: 200`), and an enumeration bug are all consistent with what is measured here, and
nothing above distinguishes them.

⚠ **The verified-edge count is unaffected.** 2,820 edges derive from the current import and are what
they are. It is the *records-side* figures that were inflated.

⚠ **And the question I started with — "why does derivation keep 4.9%" — was malformed.** It compared
edges from one import against records from nine collections. The comparison never had a shared
population, which is the eighth population error in this investigation and the reason the "derivation
is lossy" hypothesis should not be carried forward on today's evidence.

---

# THE STRUCTURAL CAUSE — a 628-file corpus can never produce a complete collection

Measured, not inferred. `enumerateFirstPartyFiles` on this repo:

    maxFiles = 200   -> 200 files     (the provider's default: `enumerateTsFiles(root, { maxFiles = 200 })`)
    maxFiles = 5000  -> 628 files     (the whole corpus)

And in `lsp-collect.js`:

    const batchIncomplete = batchRemainder > 0;
    const incomplete = budgetExhausted || enumTruncated || batchIncomplete;
    const status = incomplete ? 'partial' : 'ok';

⇒ **A 628-file corpus under a 200-file cap always leaves a remainder, so every run is `partial`.**
And `pruneSupersededCollections` prunes only on a **COMPLETE** collect.

    ⇒ no run is ever complete
    ⇒ prune never fires
    ⇒ collections accumulate without bound
    ⇒ `getCodeIntelEvidenceForSymbol` queries across ALL of them and serves stale evidence

That is the chain, and every link is either measured above or read directly from the source. It
explains the nine collections, the 91.5% stale records, and why the three figures I published were
inflated — **without needing anyone to have made a mistake at the call site.**

## ⚠ WHAT IS STILL NOT EXPLAINED

**Why my run scoped 73 files rather than 200.** The cap is 200 and the corpus is 628; 73 is neither.
A continuation skipping already-collected files fits, but 624 files already hold records and
628 − 624 = 4, not 73 — so that explanation does not survive its own arithmetic. **Undiagnosed, and
I am not proposing a fourth mechanism today after three died.**

⚠ And note what this does NOT say: it does not say the cap is wrong. 200 files per batch may be
exactly right for a language server. **The defect is the coupling** — making an unbounded-growth
cleanup depend on a completeness condition that a capped batch can never satisfy.

---

# ⛔ THE "EDGE DERIVATION" FINDING IS ALSO WITHDRAWN — THE PAIR WAS HALF STALE

`ef-manager`, splitting every number by which store it read:

    RETRACTED (records-side, 91.5% superseded)
      97.6% of declarations have reference evidence
      10 of 10 richest qnames reachable

    SURVIVING (edges-side, one import)
      2,820 LSP_VERIFIED CALLS · 74.5%/25.5% ci:lsp split
      8.4% of declarations reachable by a verified edge
      2 of 30 consumer-side

⇒ The comparison that produced *"the gap is edge derivation"* was **97.6% against 4.9%** — one dead
term and one live one. **It was never a like-for-like comparison**, and correcting it from "all
records" to "reference records" did not fix that, because both versions used the stale numerator.

⇒ **WITHDRAWN.** There may or may not be a derivation gap; today's evidence cannot say. That is the
fourth mechanism hypothesis to die in one afternoon — node-join, failed-match, lossy-derivation, and
now the pair that motivated it.

# ⭐ INDEPENDENT EVIDENCE THE EDGES SURVIVE — the leg my claim was missing

I asserted "the 2,820 edges are unaffected because they derive from the current import" by reading
the importer. `ef-manager` supplied a check that does not depend on reading any code:

    9 collections · 182,594 records · 2,820 verified edges

If edges accumulated the way records did, nine imports at ~2,800 each would leave roughly **25,000**.
2,820 is **inconsistent with accumulation**, so the edge delete demonstrably fires. Arithmetic on the
table, not an inference from the deleter.

# ⛔ AND THE SURVIVING HALF RESTS ON THE SAME BLIND SPOT

    every one of the 2,820 edges carries extractor `ts-langserver#nohash`
    identical across all nine collections · THERE IS NO collection_id ON AN EDGE

⇒ The question that sank the records — *which collection did this come from?* — **cannot be asked of
an edge either.** Today the answer is "the current one", and that is true because a delete fired,
**not because the row says so**.

⇒ **The edges are protected by a MECHANISM, not by IDENTITY.** If that delete ever silently fails to
match — a narrowed scope clause, a drifted stash pattern, a provider whose tag changes shape — edges
accumulate exactly as records did and **nothing in the table would reveal it.** One guard, no
detector.

⚠ Not proposing a schema change. Recording that the surviving evidence has the same unaskable
provenance as the retracted evidence, so nobody later mistakes "it is currently correct" for "it is
structurally safe".

# ⚠ ON CALLING THIS "THE EIGHTH POPULATION ERROR"

`ef-manager` pushed back and is right: **seven were caught inside the investigation before anything
shipped. This one reached Steven twice.** That is a difference in *cost*, not a difference in
*instance number*, and folding it into a running tally flattened exactly the thing that mattered.
Counting them was becoming a performance; the severity is the datum.
