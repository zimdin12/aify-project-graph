---
name: aify-project-graph
description: Use AT THE START of any session in a repo that has `.aify-graph/` — the precomputed briefs are the fastest way to orient and often avoid 2-5 shell calls. Also use when planning changes, tracing execution, or pulling cross-layer context. Prefer static briefs first; use live verbs only for precision queries the brief cannot answer. If `.aify-graph/` is missing, run `/graph-setup` to create it.
---

# aify-project-graph

This graph is a **map**, not the source of truth. Use it to narrow the search space, then read the real files before changing code.

## FIRST ACTION in any session

Before calling any other tool, check whether this repo has a graph:

```bash
ls .aify-graph/brief.agent.md 2>/dev/null
```

If it exists, **read it first** — it's 250-400 tokens of dense orientation (entry points, subsystems, hubs with role tags, features, recent activity, trust line). Much cheaper than exploring with shell.

- For orient / onboarding: read `brief.agent.md` or `brief.onboard.md`
- For change-planning: read `brief.plan.md` (has `open:` / `tests:` / `load:` per feature)
- For cross-layer context on a specific thing: `graph_pull(node="X")`

If `.aify-graph/` is missing, tell the user to run `/graph-setup` — it builds everything in one pass.

## Default workflow after reading the brief

1. **Use live verbs only when the brief is not enough** (precision queries)
2. **Verify in source files before acting** on anything the graph claims

The benchmark result (4 languages, 48 runs): briefs are 1.5–2.9× faster wall-clock AND 17–35% cheaper in tokens than live MCP on orient tasks. Reach for live verbs only when you need precision.

## Use live verbs for

**Lean profile** (default for Codex/OpenCode install, 3 verbs listed in `tools/list`):
- `graph_change_plan(symbol="X")` — safe change planning
- `graph_path(symbol="X")` — execution / route / middleware flow
- `graph_impact(symbol="X")` — blast radius

**Still callable in lean mode** (by name via `tools/call`, just hidden from `tools/list` to reduce manifest tax):
- `graph_preflight(symbol="X")` — edit safety gate for high-fan-in symbols
- `graph_pull(node="X")` — cross-layer pull (code + features + tasks + activity)
- `graph_find(query="X")` — cross-layer disambiguator (NOT an rg replacement)

**Full profile only** (Claude Code default): `graph_lookup`, `graph_whereis`, `graph_search`, `graph_callers`, `graph_callees`, `graph_neighbors`, `graph_report`, `graph_onboard`, `graph_file`, `graph_module_tree`, `graph_dashboard`, `graph_summary`, `graph_status`, `graph_index`.

## Use grep/read first for

- exact lookup when you already know the area
- single-file debugging
- checking real code text, conditions, signatures, comments
- any situation where trust is weak and the graph may be incomplete

## Hard rules

- Do not rely on the graph without reading the target files.
- Do not prefetch lots of graph verbs “just in case.”
- Do not call graph verbs in parallel.
- If trust is weak, be more conservative and read more source.

## Good patterns

### Orientation
- read `brief.agent.md`
- if still fuzzy on full profile: `graph_report()` or `graph_onboard(path="...")`
- on lean profile: use `graph_pull(node="<subsystem-dir>")` instead — same data across layers

### Planning a change
- read `brief.plan.md`
- call `graph_change_plan(symbol="X")`
- if the change crosses layers, call `graph_pull(node="X")`
- read the 1-3 files it points you to

### Trace / routing
- call `graph_path(symbol="X")`
- verify the returned files in source

### Edit safety
- call `graph_preflight(symbol="X")`
- obey the SAFE / REVIEW / CONFIRM decision

## Reality check

What the graph does well:
- repo orientation
- narrowing a change-reading set
- showing callers / impact / path / feature context

What it does not do:
- replace file reading
- know runtime-only behavior
- guarantee completeness when trust is weak
