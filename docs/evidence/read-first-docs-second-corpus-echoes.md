# read-first doc ranking — field test on a second corpus

Repo under test: `echoes_of_the_fallen` (103 Document nodes). Ranking under test: `readFirst`
in `mcp/stdio/brief/graph-shape.js` at 900b7bb. Run read-only against a `db.backup()` snapshot.

## Not the case that was asked for

The request was a repo whose documents do NOT cross-link, where signal 1 collapses to zero.
Echoes is the opposite and it is a harder case:

    aify-project-graph      155 Documents ·  131 doc->doc edges
    echoes_of_the_fallen    103 Documents ·  434 doc->doc edges

Signal 1 does not collapse here. It has plenty of data and it is wrong. The zero case is
benign — the ranking visibly falls through to signal 2. This case is not, because signal 1
answers confidently and signal 2 never runs.

## Ground truth, stated by the repo itself

`echoes_of_the_fallen/CLAUDE.md` line 3, verbatim: **"Read `AGENTS.md` first."** The correct
answer is written down in the repo, so this is not a judgement call.

## Result

    rank 1   docs/contracts/worldbuffer-authority.md      last commit 2026-04-27
    rank 2   docs/contracts/configuration-authority.md    last commit 2026-04-27
    AGENTS.md                                             NOT IN TOP 12 · last commit 2026-08-19

The stated entry point, committed the day before the run, does not appear. Both shipped
answers were last touched four months earlier.

## Signal 2 was supplied and changed nothing

First run passed only `repoRoot`, so `docRecency` defaulted to null — that run proved nothing
and is discarded. Re-run with the map actually built:

    positive control   recency map covers 103 of 103 document paths
                       AGENTS.md -> 2026-08-19 · worldbuffer-authority -> 2026-04-27
    negative control   README.md is not tracked (`git ls-files README.md` empty) -> undefined,
                       i.e. UNKNOWN, never "old" — extract.js:167 handles this correctly

    without docRecency   1. worldbuffer-authority  2. configuration-authority
    with    docRecency   1. worldbuffer-authority  2. configuration-authority   (identical)

Cause is structural, not tuning: `inbound` is a strict primary sort, so recency only separates
documents whose inbound counts are exactly equal. The staleness correction is unreachable
precisely when the corpus is dense enough to need it.

## Why inbound picks the wrong genre here

    top by INBOUND doc-links (what ships)      top by OUTBOUND degree
      19  contracts/worldbuffer-authority        95  docs/now.md
      17  contracts/configuration-authority      91  docs/operations/testing.md
      16  contracts/voxel-base-unit              85  operations/audits/cylindrical-b2-...
      15  contracts/reference-frame-selection    60  roadmap/bench-findings-for-tech-lead
      15  specs/shell-implementation-slice-plan  56  architecture/guidelines.md

    AGENTS.md   inbound 11 (below the cut) · outbound 56

Inbound links select the most-CITED document. "Read first" wants the one that ORIENTS you.
In a contract-heavy repo those are different genres: a contract is cited by everything and
read when you need the contract, not to get your bearings. Frozen contracts also accumulate
citations while never being edited, so on this corpus inbound rank and staleness correlate
POSITIVELY — the ranking is drawn toward old documents by construction.

This is the same failure shape as the resolution-rate signal refuted earlier: a metric that
tracks genre while being read as currency.

## Recommendation

One change, and it is disclosure rather than re-ranking, to match this tool's own thesis.
Do not silently re-sort on recency — the inbound evidence is real and worth keeping. Instead,
when the top-ranked document is substantially older than the corpus median, say so in `why`.
"19 documents link here, last edited 2026-04-27, 12 documents in this repo are newer" lets a
reader apply the correction the ranking cannot safely apply for them.

Not claimed: that outbound degree is a better primary sort. It was not graded, and on this
corpus its top hit (`docs/now.md`) is a status file, not an entry point either.
