---
name: aify-project-graph
description: Use when working in a repo that has `.aify-graph/` or when you need to understand unfamiliar code structure. Provides 13 graph navigation verbs (graph_report, graph_search, graph_whereis, graph_callers, graph_callees, graph_neighbors, graph_impact, graph_path, graph_summary, graph_module_tree, graph_status, graph_index, graph_dashboard) that replace grep and multi-file reads with compact, token-efficient answers. MUST call graph_report on first interaction with an unfamiliar repo. MUST call graph_impact before editing any symbol with more than one caller.
---

# aify-project-graph

This repo has (or can have) a project graph at `.aify-graph/graph.sqlite`. Use graph tools **before** reaching for grep, file reads, or directory listings when navigating code structure.

## Hard rules

1. **MUST** call `graph_report()` on first interaction with an unfamiliar repo. This is the orientation step.
2. **MUST** call `graph_impact(symbol="X")` before editing any symbol with more than one caller. Non-negotiable.
3. **Do NOT** pre-fetch whole subgraphs "just in case." (Exception: `graph_report()` is the mandatory orientation step — it is not a subgraph prefetch.)
4. **Do NOT** call every verb at session start. The graph builds on first query if needed.
5. **Do NOT** call `graph_whereis` with a partial name — use `graph_search` instead when you only know part of the symbol name.

## When to reach for which verb

### Discovery — orient and find things
| Situation | Verb |
|---|---|
| "What is this project?" | `graph_report()` |
| "Find a symbol — I only know part of the name" | `graph_search(query="UserCont")` |
| "Find a symbol — I know the exact name" | `graph_whereis(symbol="UserController")` |
| "What's in this directory?" | `graph_module_tree(path="src/auth")` |
| "Find all Classes in this repo" | `graph_search(query="", type="Class")` |
| "Find functions in the auth module" | `graph_search(query="", type="Function", file="src/auth")` |

### Analysis — understand before changing
| Situation | Verb |
|---|---|
| "What calls X?" | `graph_callers(symbol="X")` |
| "What does X call?" | `graph_callees(symbol="X")` |
| "All connections around X" | `graph_neighbors(symbol="X")` |
| "What breaks if I change X?" | `graph_impact(symbol="X")` |
| "Trace the execution path from X" | `graph_path(symbol="X")` |
| "Quick overview of X" | `graph_summary(symbol="X")` |

### Administrative
| Situation | Verb |
|---|---|
| "Is the graph ready?" | `graph_status()` |
| "Rebuild from scratch" | `graph_index(force=true)` |
| "Browse visually" | `graph_dashboard()` (opens browser — human-facing, do NOT call automatically) |

## Key parameters

Most verbs accept these optional params:

- **`top_k`** — max results returned (default 10-30 depending on verb). Increase when `TRUNCATED` appears.
- **`depth`** — hop depth for traversal verbs (callers, callees, impact, path). 1=direct, 2=two hops, etc.
- **`type`** — filter by node type in `graph_search`: Function, Method, Class, Interface, Type, Test, File, Route, Entrypoint.
- **`file`** — filter by file path prefix in `graph_search`: e.g. `file="src/auth"` only searches in that directory.

## Response format

Query verbs return compact line format with file:line citations:

```
NODE 5d9e7ebe function get_db service/db.py:217
EDGE abc123→5d9e7ebe CALLS service/routers/api_v2.py:918 conf=0.95
TRUNCATED 32 more (use top_k=20)
```

Path traces return indented stories:

```
PATH handleRequest src/server.ts:10
  -> validateToken src/auth.ts:12 conf=0.95
    -> jwt.verify external:0 conf=0.80
  -> User.findById src/models/user.ts:34 conf=0.90
```

When `TRUNCATED` appears, the result was capped. Follow the suggestion in parentheses (e.g., increase `top_k` or `depth`) to retrieve remaining items.

## Confidence scores

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
- Run `graph_index()` repeatedly — it auto-triggers on first query if missing or stale.
- Call `graph_dashboard()` automatically — it opens a browser and is for human inspection only.
