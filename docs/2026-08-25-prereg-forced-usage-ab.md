# Preregistration — forced usage A/B, round 2

**Written before any arm runs and before ground truth is established.** The previous round returned
NULL for three reasons, all mine. Each is addressed structurally here, not by promising to be more
careful.

## What the last round got wrong, and what changes

| invalidation | round 1 | round 2 |
|---|---|---|
| **The treatment was never applied.** 3 of 5 augmented agents made zero graph calls. | "told to use the tools" | a third arm where the first tool call is **mandated**, plus a discard rule below |
| **The answer key was in the carrier.** I committed the gate into the repo agents searched; one agent disclosed it unprompted. | gate and carrier were the same repo | **carrier is `C:/Docker/apg-testbed`, gate is in `aify-project-graph`** — structurally separate, not a matter of remembering |
| **The tools were a day stale.** Server on the previous build, 26 files changed. | unverified | server `startedAt` verified after restart, before any arm runs |
| *(named in round 1, never fixed)* filenames encoded the topics, so `ls \| grep` answered discovery questions | our own repo | third-party code — `fmt`, `click`, `FastRoute`, `p-queue` |

## Arms

Three, not two. Arm B exists only so round 1 remains comparable.

- **A — BASELINE.** Tools not available. Ordinary reading and searching.
- **B — TOLD.** Tools available, instructed to use them. *This is the round-1 arm that mostly
  ignored the instruction.* Kept so the comparison to round 1 is like-for-like.
- **C — FORCED.** Tools available, and the task states that the **first tool call must be a graph
  verb**, with its output quoted before any other work.

## ⛔ The discard rule, fixed in advance

**Any arm-B or arm-C cell with zero graph calls is DISCARDED before its answer is read.**

An augmented run with no graph calls is not an augmented run — it is a second baseline wearing the
wrong label, and round 1's near-miss came from scoring exactly such a cell as a win. Discards are
reported as a count, never silently dropped: *"n of m treatment cells discarded"* is itself a result
about adoption.

⚠ Graph calls are counted as `tool_use` blocks in the transcript, by name. A tool NAME appearing in
prose is not a call — grepping for `graph_` returns thousands of hits from the deferred-tool
catalogue echoed into every prompt.

## Tasks

Four, one per language, each with a mechanically checkable answer. Deliberately of the kind where a
wrong answer is *confidently* wrong — absence and reachability questions, not "explain this file".

| id | repo | language | question type |
|---|---|---|---|
| T1 | fmt | C++ | who calls a given symbol, and is a named symbol unused |
| T2 | click | Python | same, in a decorator-heavy codebase where static extraction is hardest |
| T3 | FastRoute | PHP | same — **heuristic tier only, no language server** |
| T4 | p-queue | TypeScript | same |

Exact questions and ground truth are recorded in a sibling file **after the arms are dispatched**,
never before, and never inside the carrier.

## Predictions, registered now

1. **Arm C will show a higher graph-call rate than arm B.** Trivially true if forcing works at all;
   registered so that a failure to force is visible rather than explained away.
2. **No correctness advantage on T4 (TypeScript).** p-queue is 184 nodes — small enough to read.
3. **PHP (T3) will show no `[lsp✓]` evidence in any arm**, because no language server exists for it.
   If any arm reports compiler-verified PHP evidence, the tool is lying and that is a defect, not a
   win.
4. **No prediction on T1/T2 correctness.** Nothing measured licenses one.

## ⛔ Abandon and falsification rules

- If **arm C's discard rate exceeds 50%**, forcing does not work by instruction and the result is
  reported as "the treatment cannot be applied by prompt" — a finding about adoption, not the tool.
- If **arm A matches or beats arm C on correctness**, that is published as a negative result for the
  tool, in full.
- If my **ground truth is wrong** — it was last time, in the document whose whole job was to be the
  anchor — the correction counts as a finding and the affected task is void, in every arm.
- **n = 4 tasks cannot establish efficacy.** The most this round can produce is a directional signal
  and a working protocol. Any conclusion stated more strongly than that is overreach.

## What this round still cannot establish

- Anything about other operators, machines, or model versions.
- Whether forcing usage is *desirable* — only whether it is *possible* and what it changes.
- Efficacy at any scale beyond four tasks.
