---
name: aify-project-graph
description: Use when working in a repo that has `.aify-graph/` or when you need a project map for orientation, planning, trace, or cross-layer pull. Prefer static briefs first; use live verbs only for precision queries the brief cannot answer.
---

# aify-project-graph

This graph is a **map**, not the source of truth. Use it to narrow the search space, then read the real files before changing code.

## Default workflow

1. **Read a brief first**
   - `brief.agent.md` for general orientation
   - `brief.onboard.md` for first-contact onboarding
   - `brief.plan.md` before a non-trivial change
2. **Use live verbs only when the brief is not enough**
3. **Verify in source files before acting**

The benchmark result is clear: briefs usually beat live MCP on orient-shaped tasks. Reach for live verbs when you need precision, not by default.

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
