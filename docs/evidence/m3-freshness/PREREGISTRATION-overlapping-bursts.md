# Preregistration — does an edit arriving MID-SYNC survive?

**Written:** 2026-09-02, before the probe.

## Why

M3a's remaining blockers are overlapping bursts, WSL `/mnt`, and a large C++ repo. Only the first is
measurable here, and the plan calls it *"the normal agent workload, and the one thing single-burst
timing cannot reach"*.

⚠ **But the interesting question is not cost.** Idle cost is now measured at zero, and burst cost was
measured at 36–313 ms. What sustained editing actually risks is a **lost update**: an edit that
arrives while a re-index is already running, and never makes it into the graph. That is the worst
failure this product can have — a graph that is silently stale while reporting itself fresh.

`watch.js:26-51` coalesces: if `indexing` is true it sets `pending` and returns, and the `finally`
block runs **exactly one** trailing re-index. Read, that looks sound. Reading is not measuring, and
that substitution has falsified my predictions in this project repeatedly.

## Question

After sustained editing — several edits, at least one landing while a re-index is in flight — does
the graph reflect **every** edit, or can one be dropped?

## Population

One scratch repo, watcher enabled with a short debounce. A sequence of edits, each adding a
distinctly-named symbol, written faster than a re-index completes so that at least one provably
arrives while `indexing === true`.

## Identity rule

- **Survived** = after quiescence (`indexing === false` and `pendingReindex === false`), a query
  finds the symbol from **every** edit.
- **Lost update** = any written symbol absent from the graph after quiescence.

## Finding schema

`{ symbol, writtenAt, foundAfterQuiescence: boolean }`, plus whether any edit was observed to land
while `indexing === true`.

## Controls, same pass

- **POSITIVE — the overlap actually happened.** If no edit lands during an in-flight re-index, the
  probe never exercised the case and must say so rather than report "no lost updates". This is the
  control that decides whether the run means anything.
- **POSITIVE — the watcher is `running`**, not `unsupported` on this host.
- **POSITIVE — the graph is populated at all** after quiescence; an empty graph would make every
  "absent" trivially true and every "present" impossible.
- **NEGATIVE — a symbol never written is NOT found.** Otherwise the query matches anything and
  "survived" is meaningless.

## Claim ceiling

One small repo, one OS, one editing pattern, a handful of edits. It cannot show behaviour under heavy
sustained load, on a large C++ repo, or on WSL — the two blockers it does **not** touch. It measures
**correctness under overlap**, not throughput.

## Abandon rule

If the overlap control shows no edit ever landed mid-sync, report the probe as **not having exercised
the case** and conclude nothing about lost updates.

## Decided in advance

- **No lost updates, overlap confirmed** → blocker 2 of 4 retired on the correctness axis, and I will
  say explicitly that it is retired on CORRECTNESS and not on throughput. The default still does not
  flip: WSL and the large C++ repo remain.
- **Any lost update** → a P0. A silently stale graph is worse than a slow one, and it would argue
  against default-on far more strongly than cost ever did.
