# PREREGISTRATION — sustained-edit cost under the watcher (M3a blocker 2, cost half)

**Written before the probe ran and before any number existed.** Committed ahead of results so the
decision rule cannot be chosen to fit them.

## The question

Blocker 2 bundled two questions. The correctness half — is a write landing mid-sync lost? — was
answered 2026-09-03 (no, two mutants killed, logic tier). This is the other half: **under sustained
editing, does the coalesced re-index do pathological repeated work?**

Single-burst cost is already measured (cosmetic 313 ms, body-only 36 ms, signature 42 ms, added call
35 ms, noop 39 ms, forced full rebuild 75,393 ms). ⛔ None of those describe sustained load, which is
the normal agent workload and the thing single-burst timing structurally cannot reach.

## Population

A **local git clone of aify-project-graph** in a temp directory — the real repo, real file count,
real language mix. Not a synthetic fixture: the whole objection is about a large repo, and a fixture
would answer a question nobody asked. The working tree is never touched.

## Procedure

Watcher on through `startAutoSync` with the **real `ensureFresh`** (not an injected one — this arm is
about the indexer, unlike the correctness test). One source file is edited **structurally** (a
function is renamed each iteration, forcing re-extraction and re-resolution rather than the cheap
cosmetic path) every 250 ms for 60 s.

Recorded per sync: wall time, and process CPU delta across the whole run.

## Controls, in the same pass

| arm | what it rules out |
|---|---|
| **IDLE** — watcher running, no edits, same duration | cost that is not attributable to editing |
| **METER** — a known busy loop | a CPU meter that cannot see cost at all (the instrument reading zero because it is broken) |

⛔ Without METER, a 0.0 ms result is unreadable: a broken meter and a free watcher look identical.
This exact control retired blocker 1 (idle cost) and is reused deliberately.

## Decision rule — fixed now

**PATHOLOGICAL** if any of:
1. mean sync wall time under sustained editing exceeds **5x** the single-burst structural baseline
   (42 ms => 210 ms), or
2. syncs do not **drain**: work is still queued more than 2 debounce windows after the last edit, or
3. total process CPU over the 60 s exceeds **30%** of one core.

**ACCEPTABLE** if none of the three trips.

## Abandon rule

If fewer than **5** syncs occur, or if no sync ever overlaps an edit, then sustained load was never
produced: **report that and conclude nothing.** The 2026-09-02 probe failed exactly here — it
reported "4 lost updates" on a run where its own deciding control said no overlap had happened — and
the rule exists so that outcome is written down rather than published.

## What this cannot settle

WSL `/mnt` (watcher default-off for unrelated reasons) and a large **C++** repo. This repo is
JS/TS-dominant; C++ extraction is the expensive path and is not exercised here.
