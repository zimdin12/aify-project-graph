# ⛔ The watcher reports success and never adds NEW files

**Date:** 2026-09-02
**Found while:** probing M3a blocker 2 (overlapping bursts). **The probe never exercised overlap** —
this is a different and more serious defect that surfaced instead.
**Status: PROVEN behaviour, root cause NOT isolated. No fix attempted this cycle.**

## What is proven

With the watcher enabled (`status: 'running'`, `debounceMs: 50`), edits made one at a time with
several seconds between them:

| case | reaches the graph? |
|---|---|
| control — the watcher indexes at all (first edit) | **yes** |
| **A — MODIFY an existing tracked file** | **yes** |
| **B — CREATE a new file** | **NO** |
| **C — that same new file, after `git add` + commit, plus another watcher cycle** | **NO** |

Throughout, the watcher looked healthy: `lastRunAt` advanced on **every** edit (three distinct
timestamps for three writes), `lastError` stayed `none`, and `indexing`/`pending` returned to false.

⇒ **A graph that reports itself fresh while a whole file is missing from it.** For an agent, that is
the worst shape of wrong: `NO CALLERS` for a symbol that exists, with every freshness signal green.

## The gap is in the WATCHER path, not incremental indexing

The obvious hypothesis — "incremental indexing never adds new files" — is **refuted**. Calling
`graphIndex({ force: false })` directly, with no watcher:

| step | result |
|---|---|
| first index (control) | present |
| incremental after a NEW committed file | **present** |
| incremental after modifying an existing file (control) | present |
| after `force: true` | present |

So `graph_index` adds new files correctly. Something about the watcher's invocation does not.

## What is NOT established

- **The root cause.** Both paths call `graphIndex({ repoRoot, force: false })`. What differs — an
  in-process cache warmed differently, a path-resolution difference on Windows temp dirs, the
  debounce, or something else — is **not isolated**, and I am not guessing at it in the write-up.
- **Whether it reproduces off Windows**, or on a repo that is not a fresh temp fixture.
- **Whether commit C's failure has the same cause as B's.** It is consistent with one cause; that is
  not evidence of one.

## Consequence for M3a

This is decision-relevant and it points the opposite way to the cost work:

- Idle cost: **0.0 ms** (retired blocker 1). Burst cost: 36–313 ms. Cost is not the objection.
- **But default-on would silently miss every newly created file**, which is a correctness objection
  far stronger than any timing one. ⛔ **This argues against flipping `APG_AUTO_SYNC` on by default
  until it is understood**, and it is a better reason than the ones previously listed.

## What the probe set out to do and did not

Blocker 2 was **overlapping bursts** — an edit arriving mid-sync. The preregistered deciding control
was whether any edit landed while `indexing === true`. It reported **false**: no overlap ever
occurred, because each index completed well inside the 400 ms gap between writes.

**So blocker 2 is NOT retired.** The preregistration's abandon rule said to report that and conclude
nothing about lost updates under overlap, and that is what this does. The first run of the probe
showed "4 lost updates" and it would have been easy — and wrong — to publish that as an overlap
finding.

## Next step, not taken here

Isolate the difference between the two call sites, starting with whether the watcher's `absRoot`
resolves to the same path the query side reads. A fix without a cause would be a guess, and this
project's record on guessed causes is poor.
