# The debounce never fires while editing continues — so the cost question could not be asked

**Date:** 2026-09-03
**Preregistration:** `PREREGISTRATION-sustained-edit-cost.md` (committed `1caff29d`, before the run)
**Run:** `RUN-sustained-edit-cost.txt`
**Status:** the preregistered question is **ABANDONED**. A different mechanism was observed and is
reported here as a mechanism, not as the answer to that question.

## The preregistered question is not answered

The abandon rule said: if fewer than 5 syncs occur, or no sync overlaps an edit, sustained load was
never produced — report that and conclude nothing about sustained cost. It fired.

| | observed |
|---|---|
| edits issued | 229 |
| syncs run | **1** |
| a sync overlapped an edit | **false** |

⇒ **Nothing here says whether sustained overlapping re-indexing is expensive.** That question is
still open, and the numbers in the run file must not be quoted as its answer.

## What was observed instead, and why it is not a guess

229 structural edits at 250 ms intervals over 60 s produced **zero** flushes while editing was in
progress. The mechanism is readable directly in `mcp/stdio/sync/watcher.js`:

```js
const DEFAULT_DEBOUNCE_MS = 750;            // line 31
...
if (pendingTimer) clearTimeout(pendingTimer);   // line 126
pendingTimer = setTimeout(flushBurst, debounceMs);  // line 127
```

Every event cancels the pending flush and starts a new one. **There is no maximum wait.** So while
events keep arriving closer together than `debounceMs`, the timer is reset before it can fire and the
burst never flushes. The observation and the code agree, which is why this is stated as a mechanism
rather than an inference from one run.

⚠ **The precondition, stated exactly:** starvation requires the gap between file events to stay below
`debounceMs` (default 750 ms). The probe used 250 ms. **Whether real agent workloads sustain that
rate is NOT measured here** — an agent that saves every few seconds would never trigger it. Do not
read this as "the watcher never works".

## ⭐ Why this is the reason NOT to fix it immediately

The obvious remedy is a maximum wait: flush at least every N seconds regardless of arriving events.
It is a small, standard change.

⛔ **But it converts "no work during editing" into "continuous work during editing" — which is
precisely the cost that the abandoned arm failed to measure.** Fixing the starvation is what would
*create* the sustained overlapping load whose expense is unknown. Shipping the fix first and
measuring after would be backwards, and it would land the change on the exact axis where this
project has no data.

⇒ Sequence: measure the cost of overlapping syncs with a probe that can actually produce them (drive
`ensureFresh` directly at a controlled rate, rather than hoping the watcher emits), THEN decide on a
maximum wait with that number in hand.

## Two observations from the same run that are NOT conclusions

Both contradict earlier measurements and neither has its own controls, so they are recorded as open
questions:

1. **The single catch-up sync took 53,097 ms** — against a single-burst structural baseline of 42 ms
   and a full rebuild of 67,268 ms on the same clone. That is close enough to a full rebuild to
   suspect one was taken, and I have **not** established why. It could also be an artifact of 229
   accumulated writes to one file.
2. **The idle control read 2,093 ms CPU over 15,000 ms with 0 syncs** (~14%), where the blocker-1
   measurement recorded 0.0 ms over 30 s. The idle arm ran immediately after the 53 s sync, so this
   may be that sync's tail rather than idle cost. ⛔ It is not evidence that the earlier result was
   wrong; it is evidence that this arm was not isolated.

The meter control passed in the same pass (485 ms CPU for a 500 ms busy loop), so the instrument
could see cost — which is what makes the zero-sync count readable and these two numbers worth
re-measuring rather than dismissing.

## Consequence for M3a

This is a **third** reason the default stays off, and unlike the one retired this morning it is about
the feature's own value rather than its cost: **during fast sustained editing the watcher delivers no
freshness at all**, then pays one large bill afterwards. A feature whose entire promise is "keeps the
index current automatically" not running during the activity it exists to track is a stronger
objection than any timing number.

⚠ **No test is added here on purpose.** A test pinning this behaviour would pin a defect, and would
go red the moment someone fixes it. The test belongs with the maximum-wait change, once its cost is
measured.
