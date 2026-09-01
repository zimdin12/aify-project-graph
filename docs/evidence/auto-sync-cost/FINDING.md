# M3a input — what the post-commit reindex actually costs

Found while investigating why the collision-node population changed under me mid-session. Recorded
now because it is real data on a real repo, and M3a will need it.

## ⚠ Two corrections I had to make to my own first reading

**1. It does not block.** I first reported this as "43–88 seconds per commit", which reads as
latency a developer pays. `.git/hooks/post-commit` ends the invocation with `&` — best-effort,
**backgrounded**. Nobody waits. The seconds are background CPU/IO, not blocking cost.

**2. It is not `APG_AUTO_SYNC`.** The hook runs `scripts/reindex.mjs` on HEAD movement.
`APG_AUTO_SYNC` starts a debounced filesystem watcher (`sync/auto-sync.js`) that calls `ensureFresh`
on change bursts. **They share a goal, not a code path**, and these numbers do not transfer to the
watcher. So this does *not* answer "should `APG_AUTO_SYNC` default on" — it informs it.

**3. My first parse conflated two fields.** Grepping `in Nms` returned n=964 from 482 lines, because
every line carries *two* such fields (reindex, then briefs+categorization), and I read a median off
the mixed set before noticing. The figures below come from the anchored pattern `NN/NE in Nms`,
one per line.

## The dataset

`.aify-graph/hook.log`, 482 events, **2026-08-12 → 2026-09-01** (20 days). Line shapes enumerated:
471 `post-commit`, 5 `post-rewrite`, 6 one-offs. Graph grew **4,223N/14,325E → 6,103N/20,243E**.

Reindex duration:

| bucket | n | share |
|---|---|---|
| <1s | 38 | 7.9% |
| 1–5s | 1 | 0.2% |
| 5–15s | 5 | 1.0% |
| 15–30s | 147 | 30.5% |
| 30–60s | 252 | 52.3% |
| >60s | 39 | 8.1% |

median **35.2s**, p90 **54.1s**, max **158.0s**.

## The finding worth carrying into M3a

The distribution is **bimodal**: a small ~8% fast path under one second, and **91% at 15 seconds or
more**. Whatever the incremental and cosmetic-skip machinery saves, it is **not engaging on the
typical commit here** — the full-rebuild path is the common outcome, not the exception.

That is the claim: *the incremental path is a minority outcome on real commits in this repo.* It is
**not** a cost-per-commit claim, and it is **not** a recommendation about the auto-sync default.

## Limits

One repo, one machine. Duration is wall-clock on a machine that was also running full test suites
for part of the span, so the tail is contaminated by my own load. Nothing here measures the
watcher path, which is what M3a's question is actually about.
