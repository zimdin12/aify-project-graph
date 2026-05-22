---
name: graph-walk-bugs
description: Use when the user wants engine-out bug fixing — walk features in dependency order (roots first, leaves last), surface open bug-like tasks per feature, and work through them so root fixes propagate before side-feature fixes. Produces a walk plan; user or agent iterates.
---

# graph-walk-bugs

Walk `.aify-graph/functionality.json` features in **weighted topological order** (engine-out, with load-weighting within tiers), filter `.aify-graph/tasks.json` for bug-like tasks per feature, emit a flat walk plan with depth markers + inclusion reasons + optional prep context.

## When to run

- User says "let's fix bugs engine-out", "walk through features and fix issues", "maintenance loop", "work through open bugs in dependency order"
- Before a large bug-triage session — the output becomes the session plan
- Before a release — to ensure root-level bugs are fixed before dependent features ship

## Preconditions

- `.aify-graph/functionality.json` exists and has feature edges (`depends_on`). Run `/graph-build-functionality` first if not.
- `.aify-graph/tasks.json` exists. Run `/graph-build-tasks` first to sync from your tracker.

If either is missing, tell the user and stop.

## Arguments

```
order      = weighted-topological (default) | topological | bug-density
direction  = engine-out (default, roots first) | leaf-in (reverse)
mode       = plan (default) | prep
only-status = open,in_progress (default) | custom list
labels     = bug,regression,fix (default) | custom
text       = (optional) comma-separated keywords to match in title/description
```

## Transaction shape

### 1. Load + validate

- Load `functionality.json` and `tasks.json`.
- Check every feature has an id; warn if any feature has zero anchors (low-trust).
- Check if any `depends_on` references a non-existent feature (emit as warning).

### 2. Topological sort (weighted)

- Compute depth per feature:
  - depth 0 = features with empty `depends_on`
  - depth N = features whose deps are all at depth < N
- Within each depth tier, rank by weight:
  1. **load score** — optionally call `graph_pull(node=featureId, layers=["transitive"])` for `downstream_files.total` (fallback: anchors.symbols count × 10 + anchors.files glob match count)
  2. **bug count** in this feature
  3. **stable** tiebreaker by feature id
- Cycle detection: features that can't be assigned a depth (stuck in cycle) get marked as `UNCERTAIN ORDER` and listed at the end.

### 3. Bug filter per feature

For each feature in the walk, scan `tasks.json` and include a task if ANY of:
- `task.type` in `[bug, regression, defect, incident]`
- `task.status` in `[bug, broken, regression]` or matches `only-status` arg
- `task.tags[]` intersects `[bug, fix, regression, crash]` or matches `labels` arg
- Task title / description / evidence contains any of `[bug, fix, issue, broken, crash, error, regression]` (or custom `text` arg)

**Include the `reason` per task** so the heuristic is transparent:
```
- CU-45  "parser drops python decorators"  reason=type=bug
- T-17   "edge dedup missing in resolver"  reason=title matched "fix"
```

### 4. (If mode=prep) Prep context per feature

For each feature, additionally emit:
- Top 2 `downstream_files` from transitive (high-risk spots)
- `cross_feature_risk` if downstream_features > 5 or downstream_files > 20
- Pointer to `brief.plan.md` if it exists (agent should paste the feature's chunk for context)

### 5. Emit walk plan

Flat list with depth markers. Format per feature:

```
01  depth=0  feature=storage            deps=[]                     load=20  bugs=0  ✓
02  depth=1  feature=graph-ingest       deps=[storage]              load=15  bugs=2
      - CU-45  parser drops python decorators       [type=bug]          status=open
      - T-17   edge dedup missing in resolver       [title:"fix"]       status=in_progress
03  depth=1  feature=functionality-overlay deps=[storage]            load=6   bugs=0  ✓
...
NN  depth=3  feature=mcp-server         deps=[query-verbs, brief-artifacts]  load=2  bugs=1
      - CU-80  resources/list missing brief.plan.md  [label=bug]       status=open
```

At end:
```
SUMMARY: 12 features, 4 with open bugs, 7 total open bugs.
CYCLES: (none) | (UNCERTAIN ORDER: auth↔sessions — review feature deps)
TRUST: walk_trust=strong | mixed (2 features have no anchors) | weak (3+ features without anchors, or cycles detected)
```

### 6. Tell the user how to use it

- "Start with feature #01 (`storage`) — it's the deepest root, no bugs so skip to #02."
- "When you fix a feature's bugs, re-run this skill — downstream features may inherit the fix."
- "For each feature, optionally paste `.aify-graph/brief.plan.md` or call `graph_pull(node=<featureId>, layers=['code','relations'])` before diving in."

## Trust signal

Always emit one of:

- `walk_trust=strong` — all features have anchors, no cycles, all `depends_on` refs resolve
- `walk_trust=mixed` — some low-coverage features OR one cycle OR some orphan task attribution
- `walk_trust=weak` — multiple low-coverage features OR cycles OR a meaningful fraction of tasks attributed only by fuzzy text match

If weak: tell the user the walk is directional but uncertain; they should manually sequence.

## What NOT to do

- Don't inline full `downstream_files` lists in the walk — summary counts only. The plan would drown agents with file lists per feature.
- Don't default to `bug-density` order — that breaks the engine-out intent. Expose as alt.
- Don't silently drop tasks with no feature attribution — list them at the end under `UNATTRIBUTED TASKS (N)` so they're not lost.
- Don't re-sync tasks here. That's `/graph-build-tasks`.
- Don't mutate any files. Walk is pure planning output.

## Follow-ups (not v1)

- `/graph-walk-features` — same walk but not bug-scoped, for general onboarding/exploration
- `/graph-walk-impact <symbol>` — walk dependents of a specific symbol, code-planning flow
