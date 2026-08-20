# read-first entry-point grade — PRE-REGISTRATION

Written BEFORE any ranking output was generated or inspected. Commit this before the
results file exists, so the rule cannot be fitted to the numbers.

## Population

Every repo on this machine holding `.aify-graph/graph.sqlite`, found by `find -maxdepth 3`:

    aify-project-graph · echoes_of_the_fallen · lc-api · sand_castle        (n = 4)

Excluded, with reason: `echoes_of_the_fallen/.aify-graph-PRE-RESTORE-2026-08-02`,
`.aify-graph.bak-2026-07-30`, `.aify-graph.bak-2026-08-01-PRECOLLECT-52pct-DATA`. These are
the same repo at earlier times. Three snapshots of one corpus are one corpus measured three
times, not three corpora.

n = 4 is a small population and the conclusion inherits that. Stated here rather than after.

## Ground truth — mechanical rule, no judgement

For each repo, read root `CLAUDE.md`, `AGENTS.md`, `README.md`. Ground truth is a sentence that
contains BOTH an imperative pointer (`read`, `start`, `see`) qualified by `first`/`start`, AND a
`.md` filename other than the file it appears in.

The matched sentence is quoted VERBATIM in the results with its file and line, so every ground
truth is auditable and can be rejected independently.

If no sentence matches: **NO GROUND TRUTH**. Report it as such. Do not substitute judgement about
which document "obviously" comes first — a corpus with no stated answer is not a corpus where the
ranking is right, and it is not one where it is wrong either.

## What is measured

Top 2 only, since that is what the section ships. Three orderings over the same eligible set:

    inbound-primary    what ships at a8f1337
    recency-primary    last commit date, newest first
    outbound-primary   outbound edge degree, highest first

A corpus PASSES an ordering if the stated entry point is in that ordering's top 2.

## Pre-registered thresholds

Set now, before the numbers exist:

- **Withdraw the section** if the stated entry point falls outside the top 2 under the SHIPPED
  ordering on a majority of ground-truth corpora — graph-tech-lead's own threshold, adopted.
- **Bigger finding, supersedes the above:** if ALL THREE orderings miss on a majority of
  ground-truth corpora, no signal in this graph identifies an entry point, and the section should
  stop claiming to rather than be re-tuned.
- A corpus with NO GROUND TRUTH counts toward neither numerator nor denominator, and the
  denominator is reported alongside every rate.

## Not measured, deliberately

Whether a ranked document is a GOOD document to read. Ungradeable, and named by graph-tech-lead
as the trap that killed the skills classifier. This grades one thing: does the ranking surface
the entry point the repo itself names.
