# Attribution

## graphify

Patterns adapted from [safishamsi/graphify](https://github.com/safishamsi/graphify), MIT licensed.

Specifically:
- The compact NODE/EDGE line response format
- The high-intent named query verb surface
- The GRAPH_REPORT.md interface-first digest concept
- Top-K seed selection + bounded BFS depth + hard token-budget truncation

No source code is copied verbatim; these are design patterns reimplemented.

Additionally, the import-evidence resolution Tier-A heuristic (resolve a
short-name call only when it matches an imported alias AND maps to exactly one
node, with INFERRED provenance for non-unique candidates) is adapted from
graphify's `symbol_resolution.py`.

## agent-understand-anything

JS/TS import-specifier resolution heuristics in
`mcp/stdio/ingest/import-resolution.js` and `mcp/stdio/ingest/js-import-evidence.js`
are reimplemented from
[agent-understand-anything](https://github.com/) `extract-import-map.mjs`, MIT
licensed. Specifically:
- Extension/index-ladder probing of import specifiers against the candidate
  file set.
- tsconfig/jsconfig `compilerOptions.paths` + `baseUrl` alias matching, with the
  load-bearing `posix.normalize` leading-`./` strip (create-next-app
  `"@/*": ["./*"]`).
- A `require()` regex pass for CommonJS coverage that tree-sitter's
  `import_statement` rule misses.

No source code is copied verbatim; the type shapes differ (our JS+SQLite vs
their TS) so these are heuristics reimplemented.

## codegraph

The packet `clampToBudget` skeletonize-before-drop behavior in
`mcp/stdio/query/verbs/packet.js` (Tier-1 collapse directory-prefixed list
items, Tier-2 header+count, Tier-3 drop only as last rail, never dropping the
target section) is adapted from codegraph (#564/#569), MIT licensed. Pattern
reimplemented, not copied.

## Karpathy's LLM Wiki

The concept of "persistent structured artifact between model and raw sources" is inspired by Andrej Karpathy's [LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). Our implementation addresses the failure modes identified in [this critique](https://medium.com/data-science-in-your-pocket/andrej-karpathys-llm-wiki-is-a-bad-idea-8c7e8953c618) by using deterministic tree-sitter extraction instead of LLM-generated content.
