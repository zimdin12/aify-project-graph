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

## ⛔ CORRECTION 2026-09-03 — "the gap is in the WATCHER path" was WRONG

The section below concluded the watcher's invocation was at fault. **It is not.** A bisection ran the
watcher and then called `graphIndex({ force: false })` **directly, in the same process, on the same
repo**: the new file was still absent. Path resolution was identical (`resolve(repo) === repo`), and
the watcher's own control passed.

⇒ The watcher is a **victim, not the cause**. It fires correctly on a real event and calls an indexer
that cannot see the file. What follows is the corrected characterisation.

### The real rule, measured in one sequence

| case | seen by incremental index? |
|---|---|
| NEW file, **uncommitted** | **NO** |
| the same file, after `git add` + commit | yes |
| MODIFIED tracked file, uncommitted | yes |

### And it is an INCONSISTENCY, not a policy

| the same untracked file | indexed? |
|---|---|
| incremental, graph already exists | **no** |
| **full rebuild (`force: true`) on the same tree** | **yes** |
| present at the **first** index of a repo | **yes** |

**The same bytes are in or out of the graph depending only on WHEN they arrived.** Excluding untracked
files would be a defensible policy; this is not that policy, because two of the three paths include
them.

⚠ **The mechanism is still NOT isolated.** The obvious candidate — `getTrackedDirtyFilesSync`, which
deliberately drops untracked entries for good, field-reported reasons — is **not used by the indexer**
(its only consumer is `packet-input.js:154`, for the dirty count). I am not naming a cause I cannot
point at.

## SUPERSEDED — the original section, kept for the record

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

## ⛔ CORRECTION 2026-09-03 — "silently" IS FALSE, AND THIS IS NOT AN AUTO-SYNC BLOCKER

See `FINDING-untracked-gap-is-disclosed-not-silent.md`, measured with controls in the same pass.

- The absence now NAMES the file and the remedy: `NOT COVERED: src/newthing.js (untracked) —
  uncommitted, so not indexed.` Verified through three independently-written verbs; a clean tree
  emits no such clause, so it is a discriminator and not decoration; and `force:true` really does
  index the file, so the remedy it recommends is true.
- The gap is not caused by the watcher OR by `APG_AUTO_SYNC`. The four installed git hooks run
  `scripts/reindex.mjs` -> `ensureFresh({ repoRoot })` incrementally on every commit with the flag
  OFF, so the gap is identical either way.

⇒ The "Consequence for M3a" section below is SUPERSEDED. It is kept because the reasoning it records
is the reason the blocker sounded decisive, and because this file was written one day before the
disclosure landed — it expired rather than being wrong when written. ⚠ Case C (a new file missing
even after `git add` + commit) is NOT covered by that correction and is still live.

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
