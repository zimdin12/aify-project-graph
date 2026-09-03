# I rebuilt the 445-byte warning wall, one justified clause at a time

**Date:** 2026-09-03
**Probe:** `scripts/probe-absence-answer-budget.mjs`
**Status:** MEASURED. The threshold was fixed before the run, using this repo's own recorded number.

## Result

A real `NO CALLERS` answer on this repository:

| | bytes |
|---|---|
| answer + remedy | 200 |
| **caveat remainder** | **1057** |
| historical wall this project tore out | 445 |

**2.4x the prose that was already removed once for being unreadable.**

What the agent receives:

```
SNAPSHOT WARNINGS
- working tree has 1 modified tracked file; live reads use the last completed snapshot

NO CALLERS for "MANIFEST". Try graph_whereis(...) for an overview.
TRUST: absence is from the heuristic graph and is NOT exhaustive — ...
INDEXED SCOPE: 932 files — this absence is within that scope, not a statement about the repository.
SCOPE: the newest code-intel collection is typescript, which processed 73 of 627 eligible files; ...
NOT MODELLED: a call through a computed key — table[name](), obj[k]() — is invisible ...
NOT COVERED: <file> (modified) — uncommitted, so not indexed. Commit or graph_index({force:true}) ...
SCOPE: this verb searched the strict call graph (CALLS/INVOKES/PASSES_THROUGH) and did NOT search
REFERENCES — of which this graph holds 1 REFERENCES pointing at "MANIFEST". ...
```

⭐ **THREE separate scope statements, two of them sharing the label `SCOPE`.**

## The mechanism, which is the point

Every clause here was added with a byte measurement and a preregistered threshold. Every one of them
is individually defensible, and I would defend each again. **They were each measured against the
answer as it stood BEFORE the previous one landed, and never against the total.** A wall is not built
by one reckless paragraph; it is built exactly like this.

⇒ **A per-item budget is not a budget.** The rule that would have caught this is: measure the
aggregate, every time, and make the newest clause argue against the existing total rather than
against the original bare answer.

## What this does NOT say

- **No individual clause is identified as unjustified.** Each names a different fact — how much was
  indexed, what the verified collection covered, which relations were searched, what is unmodelled,
  what is uncommitted. Deleting one at random would remove information, not noise.
- **It does not measure whether agents read any of it.** That is the question that would decide WHICH
  clause goes, and it is not answered here. Byte counts cannot settle it.
- ⚠ The per-clause decomposition is approximate: the second `SCOPE:` occurrence is attributed to the
  clause before it, so individual figures are indicative. The TOTAL is computed as total minus
  answer and does not depend on that split.
- ⚠ Roughly 160 B of the measured caveat is the `NOT COVERED` clause naming the probe's OWN modified
  file — self-referential contamination. Subtracting it still leaves ~900 B, over 2x the wall.

## What I am doing about it now, and what I am not

**Now:** a standing gate that fails when the caveat remainder grows, so the next addition must trim
before it adds. It records the current number as a ceiling **without blessing it** — the number is
already over the historical wall.

**Not now:** choosing which clause to cut. That is a design decision about what an agent actually
reads, it needs a reviewer, and comms to graph-senior-dev has been HTTP 401 for this entire session.
Cutting one on my own judgement, having just demonstrated that my judgement produced a wall, is not
the move.
