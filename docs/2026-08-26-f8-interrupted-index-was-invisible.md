# F8 — an interrupted index left the graph silently degraded, and every check agreed it was fine

## What was observed

A `graph_index` run killed mid-write left the `click` arm holding **90 nodes** — Document 43,
Directory 25, Config 22 — and **zero code nodes**. At that moment:

- the database file existed
- it opened cleanly
- the node count was plausible for a small repository
- `graph_health` reported it indexed, with `manifestStatus: 'ok'`
- every check available said fine

## Why nothing caught it

`writeManifest` writes to a temp file and renames atomically. The manifest is therefore replaced
only at the **end** of a successful index — so an interrupted run leaves the **database** mangled
while the **manifest** still describes the previous good state.

    manifest says   2,572 nodes      <- from the last SUCCESSFUL index
    database holds     90 nodes      <- what the interrupted run left
    manifestStatus  ok               <- the run never got far enough to record failure
    file exists     yes
    opens cleanly   yes

⛔ **The run that fails hardest is the one that never rewrites the manifest.** The existing
`previous-run-did-not-finish` verdict keys on `manifestStatus`, so it is structurally blind to
exactly this case — it can only report failures that finished failing.

⇒ The two sides disagreed and **nothing compared them**. Every check read one side or the other,
which is several checks sharing one blind spot, i.e. one check.

## The signal, with its control

Measured across the pinned corpus in the same pass, healthy graphs agree **exactly**:

| arm | manifest | database | agree |
|---|---|---|---|
| fmt | 6,735 / 14,855 | 6,735 / 14,855 | yes |
| click | 2,572 / 13,618 | 2,572 / 13,618 | yes |
| fast-route | 489 / 1,343 | 489 / 1,343 | yes |
| p-queue | 184 / 384 | 184 / 384 | yes |

⭐ Exact agreement on all four arms is the positive control: a mismatch is signal, not drift.

**Two signals, and the pair is required.** Either alone is ambiguous:

| signal | fires wrongly on |
|---|---|
| database short of the manifest | a pruned collection |
| zero code nodes | a legitimate docs-only repository |

Together they are the observed failure and little else. A graph holding *more* than the manifest
promised is not partial either — a collection legitimately adds nodes after the index that wrote it.

⚠ **Unknown refuses to accuse.** Absent counts return `false`. The opposite default would condemn
every pre-existing graph whose manifest predates these fields.

## Where it went — a REASON and a verdict, not a new field

`graphCapabilities` already owns "what can this graph's answers support", and a half-written graph
cannot support orientation either — so this is one more **value** in `reason`, a field a reader
already consults, rather than a second place to look.

    orientationUsable: false
    absenceAuthority:  false
    reason:            'index_incomplete'
    nextAction:        'graph_index({ force: true }) — this graph is partial: the manifest describes
                        2572 nodes and the database holds 90. Treat every answer from it as a floor,
                        including orientation.'

And a `summary` line, because that is the surface an agent reads before any nested object:

    index-incomplete: the manifest describes 184 nodes but the database holds 98, and none of them
    is code. A previous index did not finish writing. Run graph_index(force=true); until then every
    answer, orientation included, is a floor.

It is **not** added to `nextActions` as well — this repo already fixed a
nextActions-duplicated-into-summary defect, and three surfaces for one finding is enough.

## Evidence

**Both directions, through the real verb, in the same pass:**

    fmt          orient=true   reason=no_collection        not accused
    click        orient=true   reason=collection_partial   not accused
    fast-route   orient=true   reason=no_language_server   not accused
    p-queue      orient=true   reason=no_collection        not accused
    pq-partial   orient=false  reason=index_incomplete     ACCUSED — "manifest 184 / database 98"

`pq-partial` is a real p-queue graph with its code nodes deleted — the observed shape, reproduced.

⭐ `fast-route` still reporting `no_language_server` is a second control: that branch needs a
non-null primary language, which comes from `dominantGraphLanguage`. Its query was edited in this
change and its `catch` swallows every error, so this line is the only thing proving it still runs.

**11 mutants, 11 killed** — 6 on the detector, 5 on the wiring, each verified to have actually
applied before running, each restored green afterwards:

    detector inert · zero-code pairing dropped · short-of-manifest pairing dropped ·
    orientation ignores it · absenceAuthority ignores it · nextAction falls through ·
    integrity never passed · summary verdict removed · codeNodes counts every type ·
    dbNodes reads the manifest · manifest side dropped

## ⛔ Three things this got wrong first

1. **The reason value had no consumer branch.** `index_incomplete` fell through to the default
   `nextAction`, telling the operator to run a 60-second collection on a graph that needed
   rebuilding. Executing it caught that; reading it had not.

2. **My verdict probe read a field that does not exist.** I checked `r.verdicts` and got `0` on
   every arm, healthy and partial alike. `verdicts` is the local variable; the response field is
   `summary`. A probe that cannot return PRESENT cannot return ABSENT — and this one returned a
   uniform zero that looked exactly like "the fix does not work."

3. **Four bare negative assertions**, caught by the repo's own guard. `expect(summary).not.toMatch(…)`
   passes identically whether the summary is clean or the regex is dead. Replaced with
   `expectAbsentWithLiveMatcher`, whose canaries prove the matcher fires on the real accusation and
   stays silent on the adjacent `previous-run-did-not-finish` line.

## Suite

367 files, 2,975 tests. **2,970 passed, 4 skipped, 1 failed:**
`tests/integration/code-intel/live-verbs-real.test.js` — `expected 'not_found_after_retry' to be
'found'`, a real-clangd retry exhaustion under full-suite parallel load.

Not caused by this change, and that is checked rather than assumed: the test imports only
`mcp/stdio/code-intel/*`, and nothing under that tree imports `verbs/health.js` or
`graph-capabilities.mjs` — the two files this change touches are not in its import graph. It passes
twice in a row when run alone. It is a pre-existing flake under load, reported here rather than
rounded down to a green suite.
