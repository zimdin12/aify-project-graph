# The verified spine decays; it is not lost, and it was never dedup

2026-08-30. The roadmap has carried this since 2026-08-19, marked open and explicitly not chased:

> ⚠ **OPEN, not chased:** a reindex after collection took verified edges 3008 → 2820 (−6%). The
> underlying evidence is intact (182,594 records, 640 files), so this is plausibly dedup rather than
> loss — but it is unexplained and is recorded rather than assumed benign.

It is neither dedup nor loss. Three separate mechanisms produce that number, and only one of them is
a defect — a defect that was being **fixed**, not caused.

## Why two counts could never have answered it

Dedup and loss look identical from a pair of totals. Dedup means the survivors still cover every
distinct original; loss means specific edges are gone. Only the set says which, so this was measured
as a set difference over `(from_id, to_id, relation)` across a real forced reindex of this
repository, snapshotting before and after.

**Dedup is falsified outright: 1,943 rows / 1,943 distinct before, 1,054 / 1,054 after. Zero
duplicate verified edges existed on either side**, so there was nothing for a dedup to collapse.

## What the set difference actually shows

    before distinct : 1943
    after  distinct : 1054   (delta -889)
    LOST            : 1277
    GAINED          : 388     <-- a pure loss would gain nothing

### 1. Most of it is the salvage gate doing its job — 1,262 of 1,277

After a full rebuild wipes the edges, the trust spine is re-synthesized from the stored collection
only for files git says did not change between the collection's commit and HEAD. The run says so out
loud:

    salvaged 1425 LSP-verified edge(s) from 38 of 88 file(s) unchanged since 36de4eb;
    evidence for 50 changed file(s) was NOT re-stamped

1,262 of the 1,277 lost edges belong to files in that changed set (464 files changed, the control for
this split being non-empty). Declining to re-stamp clangd line numbers onto shifted code is correct;
the alternative is stamping stale evidence as compiler-verified.

### 2. Identity churn inflates both counts — 158 of 168 on the unchanged files

Comparing by node id is the wrong instrument. Across the five unchanged files that appeared to lose
edges, **158 of 168 edges were still present after the reindex under a different node id**. That is
why 1,277 lost sits beside 388 gained: the same logical edge is counted in both columns when its
endpoints are rebuilt with new ids. Compared by label, almost all of it never moved.

### 3. Ten edges genuinely vanished, and all ten were WRONG

| edge | why its removal is correct |
|---|---|
| `…test.js -CALLS-> allowed` ×4 | `allowed` is a **destructured parameter** of `expectAbsentWithLiveMatcher` (`tests/helpers/live-matcher.js:44`), not a callable |
| `…test.js -CALLS-> forbidden` ×4 | same parameter list, same reason |
| `specId -CALLS-> openArm` | `openArm` occurs **zero times** in `tests/fixtures/hostile-kill-arm.mjs`, the file the edge named as its own source (`grep -c` exit 1, 0 occurrences) |
| `emit -CALLS-> openArm` | same |

The first eight are precisely the defect the roadmap recorded two paragraphs earlier — "it fired on a
destructured PARAMETER whose callers were property references carried under `CALLS`. Targets are now
restricted to callable declaration types." The last two are worse: `LSP_VERIFIED` edges pointing at a
symbol absent from their own source file.

⇒ **Every genuinely-lost edge was a false edge.** The count went down because the graph got more
honest.

## The finding that matters more than the −6%

The −6% was an early symptom of something systematic. This repository is now **121 commits and 464
changed files** past its last collection, and a single reindex took the verified spine from 1,943 to
1,054 — a **46% drop in one run**, all of it legitimate under the salvage gate.

⇒ **The compiler-verified trust spine decays as a function of commits since the last collection**,
and on an active repository it erodes toward nothing between collections. That is by design and each
step is defensible, but the emergent behaviour is that the highest-trust evidence tier is mostly
absent exactly when the repository is being worked on hardest. It also explains the roadmap's older
observation that `LSP_VERIFIED` "read 0 here for the life of the repo while collections had genuinely
run" — same mechanism, further along.

This is recorded, not fixed: the remedy is a re-collect policy question (when, how often, triggered by
what), and it costs clangd time on every trigger. Naming the decay curve is the part that was missing.

## A wrong instrument, kept for the record

⛔ **My first probe compared the wrong nouns.** It measured files carrying `code_intel_records`
against files carrying verified edges and called the difference loss — reporting 15 "lost" files with
a `.d.ts` of pure declarations at the top. **A record is a symbol; an edge is a relationship.** A file
can hold thousands of records and legitimately produce no call edges at all. The falsifier fired, and
it was the instrument that was wrong, not the code. Records are not edges.
