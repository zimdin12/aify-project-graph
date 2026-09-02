# The watcher costs 0.0 ms of CPU when idle — blocker 1 of 4 retired

**Date:** 2026-09-02
**Preregistered:** `docs/evidence/m3-freshness/PREREGISTRATION-watcher-idle-cost.md`
**Cost:** zero agent budget.

## Result

30 s idle per arm, both arms in one process (so host noise is shared, not compared across runs), the
control arm run **first** so any warm-up lands on the control rather than flattering the watcher:

| arm | cpu user | cpu sys | rss delta |
|---|---|---|---|
| B — control, no watcher | 0.0 ms | 0.0 ms | −17,588 KB |
| A — watcher **running** | 0.0 ms | 0.0 ms | **+4 KB** |

**Idle CPU cost: 0.0 ms over 30 s.**

Controls, same pass: the watcher reported `status: 'running'` (so this measured a live watcher, not
an `unsupported` no-op on this host); a deliberate 1 s busy loop registered 1000.0 ms, so the meter
can see cost; both idle arms were the same length.

## ⛔ One number I am NOT reporting as a result

The naive `A − B` for memory is **+17,592 KB**, and that figure is meaningless. The control arm's RSS
*fell* by 17,588 KB — a garbage collection landed during it. Subtracting a GC in an unrelated arm and
calling the remainder "the watcher's memory cost" is arithmetic on the wrong noun.

**Arm A's own RSS delta is +4 KB**, which is the honest number for what enabling the watcher did to
memory over 30 s.

## What this retires, and what it does not

The M3a finding named four blockers to flipping `APG_AUTO_SYNC` on by default, "none of them a timing
question". This retires the **first**:

- ✅ **the watcher's own idle cost** — 0.0 ms CPU, +4 KB RSS over 30 s.
- ⛔ **overlapping bursts** — sustained editing where a burst arrives mid-sync. Still open; needs a
  harness this did not build.
- ⛔ **WSL / `/mnt`** — still open, and unmeasurable here. The watcher is deliberately default-off
  there (`watcher.js:81`: *"recursive fs.watch is pathologically slow on WSL /mnt/\*"*).
- ⛔ **a large C++ repo** — still open, and the same corpus gap M5 exists to close.

**This does not flip the default**, and the preregistration said so before the number existed.

## A correction to the blocker's own wording

The finding described flipping the default as *"starts a background process for every install"*.
Measured against the implementation, that is the wrong noun: `startWatcher` registers **one recursive
`fs.watch` handle in the existing server process**, with **no polling fallback**, and deliberately
**not** one watch per directory (`watcher.js:101-103`, "inotify-budget hygiene"). No process is
spawned.

That matters for the decision: the objection people usually mean by "a background process per
install" — a daemon burning cycles — is measured here at zero. What remains open is behaviour under
*load*, not at rest.

## Ceiling

One repo, one OS (**Windows**), one 30 s interval, **idle only**. It says nothing about cost under
editing, nor about inotify/handle budgets on Linux, which this host cannot exercise. A longer interval
could surface periodic wakeups this one did not.
