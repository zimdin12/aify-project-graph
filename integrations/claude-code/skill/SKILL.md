---
name: aify-project-graph
description: Use when working in a repo that has `.aify-graph/` or when you need to understand unfamiliar code structure. Provides graph-based navigation verbs (graph_whereis, graph_callers, graph_path, graph_impact, graph_report) that replace grep and multi-file reads with compact, token-efficient answers. MUST call graph_report on first interaction with an unfamiliar repo. MUST call graph_impact before editing any symbol with more than one caller.
---

# aify-project-graph

This repo has (or can have) a project graph at `.aify-graph/graph.sqlite`. Use graph tools **before** reaching for grep, file reads, or directory listings when navigating code structure.

## Hard rules

1. **MUST** call `graph_report()` on first interaction with an unfamiliar repo. This is the orientation step — it gives you the directory layout, languages, entry points, routes, docs, and hub symbols in one call.
2. **MUST** call `graph_impact(symbol="X")` before editing any symbol with more than one caller. Non-negotiable. Read the result before making the edit.
3. **Do NOT** pre-fetch whole subgraphs "just in case." The graph is on-demand — query only what you need.
4. **Do NOT** call every verb at session start. The graph is lazy — it builds on first query if needed.

## When to reach for which verb

| Situation | Verb |
|---|---|
| "What is this project?" | `graph_report()` |
| "Where is X defined?" | `graph_whereis(symbol="X")` |
| "What calls X?" | `graph_callers(symbol="X")` |
| "What does X call?" | `graph_callees(symbol="X")` |
| "What's in this directory?" | `graph_module_tree(path="src/auth")` |
| "Trace me the execution path from X" | `graph_path(from="X")` |
| "What breaks if I change X?" | `graph_impact(symbol="X")` |
| "Show me one symbol compactly" | `graph_summary(node="X")` |
| "What's connected to X?" | `graph_neighbors(node="X")` |
| "Is the graph current?" | `graph_status()` |
| "Rebuild the graph" | `graph_index(force=true)` |
| "Browse the graph visually" | `graph_dashboard()` |

## Response format

Every query response is compact line format:

```
NODE <id> <type> <label> <file>:<line>
EDGE <from>→<to> <RELATION> <file>:<line> conf=<0..1>
TRUNCATED <N> more (use <suggestion>)
```

Path responses use indented tree format:

```
PATH handleRequest src/server.ts:10
  → validateToken src/auth.ts:12 conf=0.95
    → jwt.verify external:0 conf=0.80
  → User.findById src/user.ts:34 conf=0.90
```

## Interpreting confidence scores

- `1.0` — direct syntactic relationship (explicit call, import, class definition)
- `0.8-0.95` — high-confidence inferred relationship
- `0.6-0.8` — framework-inferred (facades, route dispatch, convention-based)
- `0.5-0.6` — structural guess (C++ templates, macro-generated code)

Lower confidence = more magic involved. Direct calls sort first in results.

## Trust signals

If `graph_status()` reports `unresolvedEdges > 0` or `dirtyEdgeCount > 0`, the graph is partially stale. For safety-critical edits, prefer fresh `Read` and run `graph_index(force=true)` if needed.

## Do NOT

- Read file contents through the graph — use `Read` for source code, graph for structure.
- Assume graph content was pre-injected into your context — it wasn't.
- Treat `graph_report()` as authoritative when `dirtyFiles` is non-empty.
- Run `graph_index()` repeatedly — it auto-triggers on first query if the graph is missing or stale.
