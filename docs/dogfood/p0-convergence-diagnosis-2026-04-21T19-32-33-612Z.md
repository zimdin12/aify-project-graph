# P0 convergence diagnosis — 2026-04-21T19-32-33-612Z

Repo: `C:\Docker\aify-project-graph`

## Counts

| State | Nodes | Edges | Unresolved (manifest.dirtyEdgeCount) |
|---|---|---|---|
| Baseline | 1268 | 3044 | 696 |
| After incremental | 1277 | 3016 | 2709 |
| After force | 1277 | 3016 | 2709 |

**Incremental → Force delta on unresolved:** 2709 → 2709 (+0)

## Edge set divergence

| Set | Count |
|---|---|
| In both | 3016 |
| Incremental only (force dropped these) | 0 |
| Force only (incremental missed these) | 0 |

### Sample: edges incremental has but force dropped (first 20)

_(none)_

### Sample: edges force has but incremental missed (first 20)

_(none)_

## Unresolved sample — incremental

- IMPORTS "graphology" [javascript] at mcp/stdio/analysis/communities.js
- IMPORTS "graphology-communities-louvain" [javascript] at mcp/stdio/analysis/communities.js
- CALLS "parse" [javascript] at mcp/stdio/analysis/communities.js
- CALLS "run" [javascript] at mcp/stdio/analysis/communities.js
- CALLS "set" [javascript] at mcp/stdio/analysis/communities.js
- CALLS "get" [javascript] at mcp/stdio/analysis/communities.js
- CALLS "push" [javascript] at mcp/stdio/analysis/communities.js
- IMPORTS "node:fs.promises.readFile" [javascript] at mcp/stdio/analysis/mentions.js
- IMPORTS "node:path.join" [javascript] at mcp/stdio/analysis/mentions.js
- REFERENCES "docs" [javascript] at mcp/stdio/analysis/mentions.js

## Unresolved sample — force

- IMPORTS "graphology" [javascript] at mcp/stdio/analysis/communities.js
- IMPORTS "graphology-communities-louvain" [javascript] at mcp/stdio/analysis/communities.js
- CALLS "parse" [javascript] at mcp/stdio/analysis/communities.js
- CALLS "run" [javascript] at mcp/stdio/analysis/communities.js
- CALLS "set" [javascript] at mcp/stdio/analysis/communities.js
- CALLS "get" [javascript] at mcp/stdio/analysis/communities.js
- CALLS "push" [javascript] at mcp/stdio/analysis/communities.js
- IMPORTS "node:fs.promises.readFile" [javascript] at mcp/stdio/analysis/mentions.js
- IMPORTS "node:path.join" [javascript] at mcp/stdio/analysis/mentions.js
- REFERENCES "docs" [javascript] at mcp/stdio/analysis/mentions.js

## Interpretation hints

- If **incremental-only edges** are non-empty → incremental is carrying forward edges that force rebuild no longer produces (stale pointers surviving rename/delete)
- If **force-only edges** are non-empty → incremental misses resolutions the fresh rebuild finds (the earlier hypothesis)
- If **both deltas are non-empty** → bidirectional drift; neither state is canonical
- If **counts diverge but edge-key sets don't** → the difference is entirely in external/unresolved materialization, check External nodes

Diff each sample manually before proposing a fix. The bug class (forward drift vs backward drift) determines whether the right fix is "re-examine all edges on incremental" or "warm-start force from incremental state."
