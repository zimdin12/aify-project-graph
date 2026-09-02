# FINDING — burst cost is NOT the obstacle to default-on. Measured, with a doubt I raised and refuted.

Preregistered at `PREREGISTRATION-auto-sync-burst-cost.md`. Thresholds, controls and the abandon
rule were fixed before any timing existed.

## Result

Three interleaved repeats per kind, medians:

| kind | edit | median |
|---|---|---|
| A | cosmetic (comment) | **313 ms** |
| B | body-only (local const) | **36 ms** |
| C | signature change | **42 ms** |
| D | added call | **35 ms** |
| E | noop | **39 ms** |
| F | forced rebuild | **75,393 ms** |

Warm-up (recorded separately, never folded in): **99,260 ms** — the first call after a commit does
the heavy work.

**Controls:** ORDERING (noop ≤ cosmetic, forced ≥ signature) PASS. RESOLVING (forced/noop = 1,950,
needed > 2) PASS.

**Preregistered decision: burst cost clears every threshold** — A and B under 2 s, C and D under
15 s, by three orders of magnitude.

## ⛔ THE DOUBT I RAISED AGAINST MY OWN RESULT, AND HOW IT WAS SETTLED

A structural edit (C, signature change) costing **42 ms** against a 75-second forced rebuild looked
wrong. `ensureFresh` has a TTL fast path guarded on HEAD, and these bursts edit the working tree
WITHOUT moving HEAD — so the obvious reading was that A–E returned a **cached** result and I had
measured a cache lookup while calling it a burst. Sound arithmetic, wrong noun: the exact failure
this project keeps producing.

Neither preregistered control could see it. `F` uses `force: true`, which bypasses the cache, so
both ORDERING and RESOLVING pass just as happily on cached noops.

⇒ Settled by asking whether the edit REACHED THE GRAPH, not by re-reading the timings:

```
before edit,                       probe nodes: 0
after edit + ensureFresh(no force) probe nodes: 1   <- the edit WAS extracted
after force:true rebuild           probe nodes: 1   <- POSITIVE CONTROL
after revert + rebuild             probe nodes: 0   <- NEGATIVE CONTROL
```

**The doubt was wrong.** Incremental sync genuinely re-extracts a changed file in tens of
milliseconds. The number is what it says it is.

⚠ Recorded because a doubt costs a reader as much as a claim: publishing "the TTL masked it" would
have been as wrong as publishing an unchecked recommendation, and the check cost one minute.

## ⚠ What the preregistered controls MISSED, stated so the next one is better

The control set proved the timer resolves work and that the ordering is sane. It could NOT
distinguish "did the work" from "returned a cache hit". The missing control is the one added above:
**an effect check — the mutation must be visible in the artifact the work produces.** A timing
control cannot answer that, however many repeats it runs.

## Recommendation, and what it does NOT authorise

**The cost objection to `APG_AUTO_SYNC=1` is refuted on this repo.** The standing argument against
default-on — a comment recording *"91% of reindexes take 15s or more"* — is about FULL rebuilds
(measured here at 75 s) and does not describe a burst, which is 36–313 ms.

⛔ **The default is NOT flipped, and that is not goalpost-moving.** The preregistration's claim
ceiling already listed what this run does not cover, and every item is still open:

- the watcher's own **idle cost** (this measures a burst once the watcher has fired, never the
  watcher itself)
- **overlapping bursts** — sustained editing where a burst arrives mid-sync, which is the normal
  agent workload, not the single-burst case measured here
- **WSL / `/mnt`**, where the watcher is deliberately default-off for reasons unrelated to cost
- a **large C++ repo**, where extraction per file is dearer and the file count higher

⇒ What burst cost was asked to decide, it decided: cost is not the blocker. Flipping a default that
starts a background process for every install needs the four items above, and none of them is a
timing question.

## Claim ceiling

One repo (JavaScript, 695 files with symbols), one machine, single bursts, three repeats.
⚠ Kind A (313 ms) is consistently ~8× B/C/D despite being the *cheapest* kind of edit. It is first
in each interleaved round, immediately after the forced rebuild, so it plausibly pays for that
round's aftermath. Unexplained, does not affect any threshold, and left visible rather than smoothed.
