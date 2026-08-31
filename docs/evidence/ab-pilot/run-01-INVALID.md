# Pilot run 01 — INVALID (apparatus failure, no product signal)

**Verdict: INVALID. Not a result about the graph, and not to be quoted as one.**

## What was attempted

Ten cells, spawned as managed `claude-code` agents through `comms_spawn`:

| task | current-healthy | current-torn | gate-disabled-healthy | gate-disabled-torn | no graph |
|---|---|---|---|---|---|
| C2 delete-safety | 01 | 02 | 03 | 04 | 09 |
| C6 does-anything-call | 05 | 06 | 07 | 08 | 10 |

## What happened

All spawns succeeded. The runs did not. Each dispatch failed with:

> Queued for >180s with no live claimer — the agent is up-but-deaf or never
> started a worker; failed by the queued-run backstop so the send does not pile
> up to buffer_full.

Confirmed FAILED: 01, 02, 03, 04, 10. The remainder were `starting`/`online`
with the task unread and their own backstop timers running.

## Cause — mine, and it is sequencing

Ten managed Claude Code workers were spawned inside ~100 seconds. Worker startup
lost the race against the 180-second queue backstop. Nothing about the arms,
corpus, prompts, ground truth or blinding is implicated: **the task never
reached any agent**, so no agent read a prompt, chose a route, or answered.

## What is NOT damaged

The expensive parts survive and are reusable as-is:

- both clean arm builds (control `a48554c`, treatment gate-disabled commit)
- ten isolated workspaces with opaque ids, one per cell
- graph content identical across implementations, differing only by the opaque
  workspace id; the tear applied (generation 1 -> 2)
- frozen prompts, sealed cell map, preregistered ground truth

## Why this is recorded rather than retried

Review's rule: infrastructure failure is reported INVALID, and a replay is a
SEPARATELY RECORDED DECISION. Retrying a flaky batch until it happens to
succeed is how an unreliable harness becomes a "result" — the failures vanish
and only the run that worked gets written down.

There is also a narrow sense in which this is the pilot working. It was
specified as a go/no-go that can falsify the apparatus, and it falsified the
apparatus on the first attempt at close to zero cost: no agent performed any
reasoning, so almost nothing was spent to learn that batch-spawning ten managed
workers does not work here.

## The corrected execution, pending Steven's decision

Run cells SERIALLY: spawn one, confirm its worker has claimed the run, collect
the answer and then the interview, and only then spawn the next. Removes the
startup race entirely, and commits each cell's cost only after the previous one
demonstrably worked. A serial cell that still fails to claim is a deeper bridge
problem to report to comms, not to work around.
