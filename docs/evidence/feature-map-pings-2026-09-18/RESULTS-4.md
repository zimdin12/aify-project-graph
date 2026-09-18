# Results, test 4: the pings find the stale features, and fire a little too often

Graded 2026-09-18 against `PROTOCOL-4.md` (93dff746, before any test-4 output). Grades are the
independent blind grader's.

## Numbers

| | Result | Bar |
|---|---|---|
| Features in the map written at W (2026-08-17) | 25, anchored to 132 symbols; all 132 resolve in the graph at W | |
| Graded at HEAD (2026-09-14) | 9 STALE, 16 ACCURATE, 0 UNCLEAR | recall read only if at least 5 STALE: **yes** |
| Symbol-level recall (STALE and S-pinged) | **8 of 9 = 89%** | at least 80%: **pass** |
| Symbol-level weekly ping rate | 6, 18, 8, 2 of 25 = **34%** mean | at most 30%: **fail** |
| File-level recall | 9 of 9 = 100% | at least 80%: pass |
| File-level weekly ping rate | 15, 24, 12, 6 of 25 = **57%** mean | at most 30%: **fail** |
| Specificity, cumulative W to HEAD (reported only) | symbol 4 of 16 accurate features unpinged; file 1 of 16 | |

## Decision

**Not built, as registered.** Symbol-level pings clear recall and miss the noise bar by four points. I do
not move a bar after seeing the result; whether 34% is acceptable is Steven's call, below.

## What the run showed

1. **The hard part works.** Tests 1-3 could not find stale prose reliably. Here, with the anchors written
   explicitly, a ping caught 8 of the 9 features that really went wrong, on a repo moving at about 280
   commits a week. This is the first positive result in the series.
2. **The miss is explainable.** `usage-quota` went stale in logic outside its anchored symbols (a stale
   threshold of 420s now only marks a pool stale; blanking takes about 24h). The file ping caught it. A
   feature is only as well watched as its anchors are chosen.
3. **The noise is real change, not cosmetics.** Removing comment and whitespace edits removes one ping of
   34 (`cosmetic.txt`, post hoc). Week 2 alone pinged 18 of 25 features, a refactor week in which the graph
   grew from 7,807 to 8,983 code nodes.
4. **Two of the nine STALE grades may be features that were never accurate** (the grader's own caveat:
   `dispatch-runs-and-claim`, whose docstring makes the same wrong claim, and `mcp-tool-surface`). Without
   them, symbol recall is 6 of 7 = 86%, still above the bar.
5. **Controls held in the same session.** W against W pings nothing. A function whose text changed pings S;
   a function in a changed file whose own text did not change pings F only; a made-up name is reported
   unresolved (`pos-control.txt`).

## The question for Steven

Over four weeks, 9 of 25 features (36%) really went stale on this repo. A weekly ping on 34% of features is
close to the true rate of change here, not far above it. The cost: from W to HEAD, symbol-level pings fired
on 20 features, of which 8 were STALE and 12 still ACCURATE, so 60% of cumulative pings are a re-check that
finds nothing. Options:

- **Accept the result:** do not build.
- **Build symbol-level confirmed-at pings anyway**, stating the measured cost: about a third of features
  to re-check per week on a very active repo, 89% of real staleness caught.
- **One more pre-registered run on a quieter repo**, same bars, to see whether 30% is met where commit
  volume is normal.

## Limits

One repo, one map author, one grader, four weeks. The map was written from code alone. The truth is per
feature over the whole window, so weekly precision is not measured.

## Files

`functionality-at-W.json` (the map), `grades.json`, `pings.py`, `pings.json`, `pings.out.txt`,
`boundaries.txt`, `pos_control.py`, `pos-control.txt`, `cosmetic.py`, `cosmetic.txt`, `reindex-summary.txt`.
