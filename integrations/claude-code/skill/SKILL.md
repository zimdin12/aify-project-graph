---
name: aify-project-graph
description: Use when working in a repo that has `.aify-graph/` or when you need to understand unfamiliar code structure. Provides graph-based navigation verbs that replace grep and multi-file reads with compact, token-efficient answers. MUST call graph_report on first interaction with an unfamiliar repo. MUST call graph_preflight before editing any symbol with non-trivial fan-in.
---

# aify-project-graph

This repo has (or can have) a project graph at `.aify-graph/graph.sqlite`.

## The graph is a MAP, not the source of truth

Use it to **navigate** — find where things are, who calls what, what the blast radius is. But the map can be stale or incomplete. The workflow is:

1. **Navigate with graph** — find the right files, symbols, and relationships
2. **Verify with file reads** — read the actual code before making decisions
3. **Act** — edit with confidence because you checked both graph and source

The graph tells you WHERE to look. The source code tells you WHAT to do. Never skip step 2 for safety-critical changes.

## Hard rules

1. **MUST** call `graph_report()` on first interaction with an unfamiliar repo.
2. **MUST** call `graph_preflight(symbol="X")` before editing any symbol with non-trivial fan-in. Follow the decision:
   - **SAFE** — proceed (but still read the target function).
   - **REVIEW** — read each caller file before editing.
   - **CONFIRM** — stop and confirm the change scope with the user before editing.
3. **Always verify graph results against actual source** before acting on them. The graph shows structure as of the last index — files may have changed since.
4. **Do NOT** pre-fetch subgraphs "just in case." (Exception: `graph_report()` is the mandatory orientation step.)
5. **Do NOT** call every verb at session start. The graph builds on first query (may take 1-60s on large repos).
6. **Do NOT** call `graph_whereis` with a partial name — use `graph_search` instead.
7. **Do NOT** call graph verbs in parallel — serialize them to avoid lock contention.
8. If trust shows weak confidence, prefer direct file reads for safety-critical edits.

## Typical workflow

```
graph_report()           → orient: what is this project?
graph_search("dispatch") → find: where is the dispatch code?
graph_file("api_v2.py")  → understand: what does this file do?
graph_preflight("X")     → safety check: is it safe to edit?
Read the actual code      → verify: confirm what the graph told you
Edit with confidence      → act: you know the blast radius
```

The graph saves you from reading 10 files to find the right 2. Then you read those 2 files properly before acting.

## Graph seems wrong?

1. `graph_status()` — check trust signals
2. `graph_index(force=true)` — rebuild from scratch
3. `graph_status()` again — verify counts
4. Retry your query

## Core verbs (use these daily)

| Situation | Verb |
|---|---|
| "What is this project?" | `graph_report()` |
| "Find a symbol (partial name)" | `graph_search(query="UserCont")` |
| "Find a symbol (exact name)" | `graph_whereis(symbol="X")` |
| "Find + edges (quick overview)" | `graph_whereis(symbol="X", expand=true)` |
| "Everything about this file" | `graph_file(path="service/db.py")` |
| "Who calls X?" | `graph_callers(symbol="X")` |
| "Who calls X from this dir only?" | `graph_callers(symbol="X", file="service/")` |
| "What does X call?" | `graph_callees(symbol="X")` |
| "Is it safe to edit X?" | `graph_preflight(symbol="X")` |
| "What breaks if I change X?" | `graph_impact(symbol="X")` |
| "Trace execution from X" | `graph_path(symbol="X")` |
| "Trace with all edge types" | `graph_path(symbol="X", mode="dependency")` |

## Advanced verbs

| Situation | Verb |
|---|---|
| "All connections around X" | `graph_neighbors(symbol="X", edge_types=["EXTENDS"])` |
| "Directory hierarchy" | `graph_module_tree(path="src")` |
| "Graph health" | `graph_status()` |
| "Full rebuild" | `graph_index(force=true)` |
| "Visual browser" | `graph_dashboard()` (human-only, do NOT call automatically) |
| "Find all Classes" | `graph_search(query="", type="Class", kind="all")` |

## Key parameters

- **`top_k`** — max results (increase when `TRUNCATED` appears)
- **`depth`** — hop depth for traversal verbs (1=direct, 2=two hops)
- **`file`** — scope callers/callees to a directory (e.g. `file="service/"`)
- **`expand`** — on whereis, include top edges (replaces graph_summary)
- **`mode`** — on path: `execution` (CALLS+INVOKES) vs `dependency` (all edges)
- **`kind`** — on search: `code` (default, excludes docs/dirs) vs `all`

## Response format

```
NODE id type label file:line
EDGE from_label→to_label RELATION file:line conf=0.95
TRUNCATED N more (use top_k=20)
```

Path traces:
```
PATH handleRequest src/server.ts:10
  -> validateToken src/auth.ts:12 conf=0.95
```

Preflight:
```
PREFLIGHT get_db function service/db.py:217
CALLERS 42 total (top 5): ...
IMPACT 42 CALLS, 3 REFERENCES, 0 TESTS
TESTS NONE
TRUST OK — 12 unresolved edges
DECISION: CONFIRM — 42 callers across module boundaries
```

## Confidence scores

- `1.0` — direct syntactic (explicit call, import)
- `0.8-0.95` — high-confidence inferred
- `0.6-0.8` — framework-inferred (facades, routes)
- `0.5-0.6` — structural guess (C++ templates)

## Search tips

- Search is case-insensitive: `user` finds `User`, `UserController`
- Default kind is `code` — excludes docs/dirs. Use `kind="all"` to include them.
- `graph_report()` replaces `graph_search + graph_module_tree` for orientation — don't chain all verbs serially.
- If search returns nothing useful, try a shorter query or use `graph_module_tree` to browse by directory.

## What the graph CANNOT tell you

- **Function signatures and docstrings** — the graph stores structure (who calls what), not code content. Use `Read` for actual code.
- **Runtime behavior** — dynamic dispatch, reflection, eval, monkey-patching are invisible to static analysis.
- **What triggers a function with 0 callers** — entry points called by the runtime (event handlers, CLI commands, cron jobs) may not have graph edges. Check the code.
- **Recent uncommitted changes** — the graph refreshes on git state. Unsaved edits in your editor are not reflected until you query again.
