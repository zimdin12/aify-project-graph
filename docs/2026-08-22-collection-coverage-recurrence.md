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
