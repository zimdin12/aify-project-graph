# PREREGISTRATION — a maximum wait for the watcher: what it costs, and what it buys

**Written before the option exists and before any number.** Committed ahead of the implementation so
the decision rule cannot be chosen to fit the result.

## Why this is now worth asking

Two facts changed on 2026-09-03 and they point opposite ways:

1. ⛔ **The watcher does nothing during fast sustained editing.** `watcher.js` clears and restarts the
   flush timer on every event with no maximum wait, so while events arrive closer together than
   `debounceMs` (750 ms) the burst never flushes. Measured: 229 edits over 60 s produced 1 sync, and
   it ran after the editing stopped
   (`FINDING-debounce-starves-under-continuous-editing.md`).
2. ⭐ **A sync got 7x cheaper.** One-edit incremental went 49.3 s -> 6.8 s
   (`RUN-resolver-perf-ab.txt`). Every prior cost objection was priced against the old number.

⚠ **And reads do not refresh.** `inspectReadFreshness` calls `ensureFresh` only when the database is
absent; otherwise it warns. So an agent that edits without committing has a stale graph — correctly
disclosed, still stale — until it commits or the watcher fires. The watcher is the ONLY mechanism
that would keep it current mid-task, and it is the one that starves.

## The question, stated as a trade rather than a cost

A maximum wait `W` flushes at least every `W` ms regardless of arriving events. It buys bounded
staleness and it costs duty cycle. So the measurement must report BOTH, and the decision rule must
weigh them against each other rather than treating cost alone as the verdict.

- **STALENESS** — the wall time between an edit landing on disk and a sync that observed it. This is
  the agent-facing quantity: how long the graph would answer from content that no longer exists.
  Reported as the MAXIMUM over the run, not the mean; a mean hides exactly the interval that hurts.
- **DUTY CYCLE** — fraction of wall time with a sync in flight.

## Population and procedure

A `--no-hardlinks` clone of this repository (~880 File nodes, real language mix). Sustained
structural editing — one function renamed per edit, the expensive path — every 250 ms for 60 s, the
same workload the starvation probe used, so the two runs are comparable.

Arms, all in one pass: `W = off` (today's behaviour), `W = 5 s`, `W = 15 s`, `W = 30 s`.

## Controls, in the same pass

| control | what it rules out |
|---|---|
| **W=off reproduces starvation** (<= 1 sync during editing) | the harness producing flushes the real watcher would not |
| **every arm's edits actually reach the graph** at the end | an arm that is cheap because it indexed nothing |
| **CPU meter sees a 500 ms busy loop** | a blind meter making every low number unreadable |

⛔ Without the first control this measures a harness, not the watcher.

## Decision rule — fixed now

Recommend a default `W` only if, at that `W`:
1. duty cycle **< 25%**, AND
2. maximum staleness **<= W + 2x the observed mean sync time**, AND
3. every edit is present in the graph at the end of the run.

If no arm satisfies all three, the honest answer is **"no default max-wait"**, and the starvation
stays a documented limitation rather than being traded for an unmeasured cost.

## Abandon rule

If the `W=off` control does NOT reproduce starvation, the harness is not driving the watcher the way
the real one behaves: report that and conclude nothing about any `W`. This is the rule the
2026-09-02 probe should have had and the 2026-09-03 cost probe did have — it fired then, correctly.

## Claim ceiling

Whatever this finds is **PASSES IN A HARNESS** on one platform (win32), one repo, one language mix,
at one edit rate. It cannot license a default flip of `APG_AUTO_SYNC` on its own; it can only remove
or confirm the cost objection to a max-wait. WSL `/mnt` and a large C++ repo remain untouched.
