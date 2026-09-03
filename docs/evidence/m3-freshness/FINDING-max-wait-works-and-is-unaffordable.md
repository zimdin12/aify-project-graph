# The max-wait does exactly what it claims, and it is unaffordable

**Date:** 2026-09-03
**Preregistration:** `PREREGISTRATION-watcher-max-wait.md` (committed `37f8b378`, before the code)
**Probe:** `scripts/probe-max-wait.mjs` (committed `5521d8ef`, before its run)
**Verdict: NO DEFAULT MAX-WAIT** — by the rule fixed before the numbers existed.

## Result

45 s of sustained structural editing (one function appended every 250 ms) against a clone of this
repository, watcher on, real `ensureFresh`:

| W | syncs | during burst | duty | mean sync | **max staleness** | last edit indexed |
|---|---|---|---|---|---|---|
| off | 1 | 0 | 0.0% | 8286 ms | **45.7 s** | yes |
| 5 s | 6 | 5 | 89.2% | 7219 ms | 8.5 s | yes |
| 15 s | 5 | 4 | 68.6% | 7568 ms | **15.0 s** | yes |
| 30 s | 3 | 2 | 33.7% | 8656 ms | **30.0 s** | yes |

Controls, same pass: CPU meter saw 516 ms for a 500 ms busy loop; the W=off arm reproduced
starvation (0 flushes during the burst), so the abandon rule did not fire; every arm ended with its
last edit present in the graph, so no arm is cheap because it indexed nothing.

## Two things this establishes

⭐ **The implementation is correct.** `W=15 s` yields max staleness 15.0 s and `W=30 s` yields 30.0 s
— the bound holds to the tenth of a second. The 5 s arm's 8.5 s is not a violation: a sync takes
~7 s, so the reachable bound is W plus a sync, which is why the decision rule allowed
`W + 2 x meanSync`.

⛔ **W=off starves, quantitatively.** Max staleness equals the whole editing window: 45.7 s of a 45 s
burst. The graph answered from content that no longer existed for the entire session. This is the
same defect found this morning, now with a number instead of a sync count.

## Why the verdict is still "no default"

Every arm blows the 25% duty ceiling — even `W=30 s`, at 33.7%. Nothing in the preregistered rule is
close to being satisfied.

⭐⭐ **And the binding constraint is not the watcher. It is the price of a sync.** At ~7-8 s per
incremental sync, keeping the graph fresh during sustained editing means the indexer is busy between
a third and nine tenths of the time, whatever W you pick. The watcher is only the thing that decides
*when* to pay; it cannot make the bill smaller.

⇒ The lever is incremental cost. That cost was already cut 86% today (49.3 s -> 6.8 s,
`RUN-resolver-perf-ab.txt`) and it is **still** too expensive to sustain. A rough target: at W=30 s,
duty falls under 25% once a sync costs about 5 s, and becomes comfortable around 1-2 s.

## ⛔ What this does NOT establish, including one that may matter more than the result

- **The precondition may be rare, and I did not measure how rare.** Starvation needs file events
  arriving closer together than `debounceMs` (750 ms). The probe drove 250 ms — 180 consecutive edits
  with no pause. An agent that writes a few files and then thinks would flush normally and never meet
  this. **I measured the mechanism, not its frequency in the field.** Anyone quoting this as "the
  watcher is broken for agents" is quoting more than was measured.
- **Edit counts differ across arms** (172 / 66 / 92 / 133 for the same 45 s) because the harness edits
  and syncs in ONE process, so a running sync slows the edit loop. Duty is a ratio over wall time and
  survives that, but the arms did not carry identical workloads. In production the server syncs in
  its own process and would not throttle the agent this way.
- **One platform, one repo, one edit rate.** win32, an 881-file JS/TS-dominant repo, 250 ms edits.
  WSL `/mnt` and a large C++ repo remain untouched.
- **Nothing here licenses a default flip of `APG_AUTO_SYNC`.** It removes one argument from the pile
  and adds a different one.

## ⛔ A retracted first run

The first execution reported `maxStale=0.8 s` for the W=off arm — the arm that provably never
flushed for 45 s. The metric was sync-start minus the MOST RECENT edit, which is small by
construction. What `maxWaitMs` bounds, and what an agent suffers, is how long the EARLIEST unflushed
edit went unseen; the watcher's own comment says so and the instrument beside it measured the
opposite. That run's table is void, including its "no default" verdict — which happened to match the
corrected one, and was kept out anyway. **A conservative conclusion reached with a broken instrument
is not evidence, and being right by accident is the easiest kind of wrong to keep.**
