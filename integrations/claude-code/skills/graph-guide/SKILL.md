---
name: graph-guide
description: Use when the user asks how to use aify-project-graph well, wants a recommended workflow loop, or wants optional examples for orienting, planning, debugging, reviewing, or rebuilding with the graph. This is a workflow guide, not a required command sequence.
---

# graph-guide

Optional workflow guide for using aify-project-graph well.

Use this when the user wants:
- a recommended graph-first workflow
- examples of when to use briefs vs live verbs
- a repeatable loop for planning / debug / review sessions

These are examples, not mandatory sequences. Adapt to the repo and trust level.

## Default loop

1. Read the right brief first.
- orient: `.aify-graph/brief.agent.md`
- planning: `.aify-graph/brief.plan.md`

2. Check map quality quickly.
- use `graph_health()`
- pay attention to:
  - `TRUST`
  - `OVERLAY` / `OVERLAY GAPS`
  - `DIRTY` / `DIRTY SEAMS`

3. Pick one live verb by question shape.
- narrow cross-layer context: `graph_pull(node="...")`
- change plan: `graph_change_plan(symbol="...")`
- broad blast radius: `graph_consequences(target="...")`
- execution trace: `graph_path(symbol="...")`

4. Read source as proof.
- use the graph to narrow the read set
- use files / diff as truth

## Verb choice by trust

### TRUST weak

Prefer:
- briefs
- `graph_pull`
- `graph_change_plan`
- source / grep / diff

Treat as advisory:
- `graph_consequences`

### TRUST ok or strong

Use the full live layer more aggressively.
- `graph_pull`
- `graph_consequences`
- `graph_path`
- `graph_impact`

Still verify code before changing it.

## Overlay target forms

For overlay-native targets, prefer explicit node forms:

```text
graph_pull(node="feature:terrain-generation")
graph_pull(node="feature/terrain-generation")
graph_pull(node="task:CU-123")
graph_pull(node="task/CU-123")
```

Raw ids still work when unambiguous, but explicit forms are clearer.

## Ignore files

Do not blur these together:

- `.gitignore`
  - add `.aify-graph/` here so derived graph state is not committed
- `.aifyignore`
  - add extra dirs or path/glob patterns here when local scratch/build trees should be excluded from indexing
  - examples: `build-linux-techlead`, `scratch`, `tmp-local`, `generated/**`, `*.tmp.cpp`
- `.aifyinclude`
  - use this to opt a default-ignored dir back in when it really contains source
  - examples: `build`, `vendor`

If a rebuild gets polluted by local build output, the fix is usually `.aifyignore`, not a graph verb.

## Optional workflow examples

### New session

Use when you just opened a repo:
1. read `brief.agent.md`
2. call `graph_health()`
3. if the map is thin, stop expecting dominance from live verbs

### Planning a change

1. read `brief.plan.md`
2. if target is feature/task/file scoped, start with `graph_pull`
3. if you need a code-edit sequence, call `graph_change_plan`
4. read the 1-3 files it points to

### Debugging a dirty seam

1. read `brief.agent.md` or `brief.plan.md`
2. check `DIRTY SEAMS`
3. if the target overlaps a dirty seam, trust current source + diff over cached structure
4. use `graph_pull` for nearby features/tasks/docs, not as proof

### Rebuild / refresh

1. if the graph is stale or incomplete, run `graph_index(force=true)`
2. regenerate briefs
3. if local build/scratch dirs or generated files polluted the graph, add them to `.aifyignore`
4. only then compare graph-vs-source quality

### Map enrichment

If the graph feels thin, improve the overlay before blaming the engine:
- add `tests[]`
- add `anchors.docs`
- add `depends_on`
- add `related_to`
- tighten broad task links with better `evidence` and `link_strength`

## Do not

- do not call many live verbs “because graph exists”
- do not treat `graph_consequences` as proof under `TRUST weak`
- do not skip brief regeneration after changing `functionality.json` or `tasks.json`
- do not expect bounded grep-style tasks to show the biggest graph win
