# Preregistration — what does the watcher cost when NOTHING is happening?

**Written:** 2026-09-02, before the measurement.

## Why

M3a measured burst cost and refused the cost objection on that axis (36–313 ms vs a 75 s rebuild).
The default was still **not** flipped, and the finding named four remaining blockers, explicitly "not
timing questions". The **first** is the watcher's own idle cost — *"this measures a burst once the
watcher has fired, never the watcher itself"*.

Two of the other three need environments I do not have (WSL `/mnt`, a large C++ repo). Overlapping
bursts need a sustained-editing harness. **Idle cost is measurable here, today**, and auto-sync
keeping indexes current automatically is named in the purpose statement.

⚠ **A framing I will test, not assume.** The blocker says flipping the default *"starts a background
process for every install"*. Reading `mcp/stdio/sync/watcher.js`: it is a **single recursive
`fs.watch` handle**, registered IN-PROCESS inside the existing server, with **no polling fallback**
and deliberately **not** one watch per directory. If that reading is right, "starts a background
process" is the wrong noun — but reading is not measuring, and that substitution has falsified my
predictions here repeatedly.

## Question

Over an idle interval with no edits, what CPU time and memory does an enabled watcher consume, above
an otherwise identical process with no watcher?

## Population

This repository (~450 source files), on this Windows host, over a fixed idle interval. Two arms in
the same script, run back to back:

- **A — watcher ON**: `graphWatch({ enable: true })`, then idle.
- **B — watcher OFF (control)**: identical process, watcher never enabled, then idle.

## Identity rule

- **Idle CPU cost** = `process.cpuUsage()` delta (user+system µs) across the interval, arm A minus
  arm B.
- **Idle memory cost** = `process.memoryUsage().rss` delta across the interval, A minus B.

## Finding schema

`{ arm, cpuUserUs, cpuSystemUs, rssDeltaBytes, watcherStatus }`.

## Controls, same pass

- **POSITIVE — the watcher is actually RUNNING in arm A.** `graph_watch` reports `status`; if it is
  not `running` (e.g. `unsupported` on this host) the measurement is of nothing and must be reported
  as such, not as "zero cost".
- **POSITIVE — arm B really has no watcher**, asserted from the same status surface.
- **NEGATIVE — the instrument can see cost at all.** A deliberate busy-loop must register clearly
  above both arms, or a near-zero reading proves only that the meter is broken.

## Claim ceiling

One repo, one OS, one idle interval, **idle only**. It says nothing about cost under editing, about
WSL `/mnt`, or about a large C++ repo — the three blockers this does **not** retire. It also cannot
speak to inotify/handle budgets on Linux, since this host is Windows.

## Abandon rule

If the watcher reports anything other than `running` on this host, report that the probe could not be
constructed here and conclude nothing about idle cost.

## Decided in advance

- **Idle cost indistinguishable from the control** → blocker 1 of 4 is retired, recorded as such, and
  the remaining three are named as still open. This does **not** flip the default on its own.
- **Measurable idle cost** → that is a real argument against default-on, and it goes in the finding
  with the number.
