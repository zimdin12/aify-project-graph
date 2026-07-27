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

## 2026-06 reference-borrow sweep (additional)

From **codegraph** (MIT), patterns reimplemented (no code copied):
- Dynamic-dispatch boundary detection (#687) — `mcp/stdio/query/dynamic-boundaries.js`,
  surfaced in `graph_trace`'s failure path.
- Class instantiation (`new Foo()`) as a caller/callee edge (#774/#804).
- TS/JS class-field-by-value classification (38eb4e6) — arrow/fn-expr fields
  become methods, data fields don't (`languages/_js_symbols.js`).
- Windows backslash path args in verbs (0171785) — `mcp/stdio/util/paths.js`.

From **graphify** (MIT): renamed default-export resolution (6dc23db) and
extractor-version cache invalidation (8401c50) — `ingest/resolver.js`,
`freshness/orchestrator.js`; HTML-output hardening (#1357) — escape dashboard
node labels/types/relations rendered into innerHTML.

From **codegraph** (MIT) #855: `uncaughtException`/`unhandledRejection` handlers
that tear down LSP children and exit cleanly instead of orphaning/spinning the
MCP server — `mcp/stdio/server.js`.

From **agent-understand-anything** (MIT):
- NodeNext `.js→.ts` import-specifier rewrite (a6c653e) — `ingest/import-resolution.js`.
- Dashboard guided tour (LearnPanel), inline source viewer (CodeViewer — incl. the
  graph-as-allowlist security gate), PNG export (ExportMenu), the node
  navigation-history back-stack, the hover degree tooltip (NodeTooltip), and the
  collapsible file-tree explorer (FileExplorer — folder→file tree built from the
  file_paths already on graph nodes; clicking a file focuses its node), and the
  git-diff change overlay (highlight nodes in files changed vs a git rev — a
  blast-radius seed from a real `git diff` instead of a hand-picked node) —
  `mcp/stdio/dashboard/`.

From **graphify** (MIT): isolated-nodes / knowledge-gaps + suggested-questions
report (report.py) → `computeIsolated`, the GAPS block, and the SUGGESTED
QUESTIONS block in `graph_digest` (`intelligence/analytics.js`). Also the
betweenness-ranked community-bridge analysis with hub exclusion (report.py
bridge ranking) → `computeBridges` (edge-betweenness on the cluster meta-graph,
god-object hub edges excluded) replacing the old heaviest-single-edge ranking in
the digest's COMMUNITY BRIDGES block.

From **agent-code-intel** (UNLICENSED — PATTERN-ONLY, re-derived from the described
idea, no code read into ours): comment/string masking before regex scans (used in
`dynamic-boundaries.js`); per-language analyzer dispatch (the multi-language
`code_intel_analyze` route is our own code over the existing LSP diagnostics).

## Karpathy's LLM Wiki

The concept of "persistent structured artifact between model and raw sources" is inspired by Andrej Karpathy's [LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). Our implementation addresses the failure modes identified in [this critique](https://medium.com/data-science-in-your-pocket/andrej-karpathys-llm-wiki-is-a-bad-idea-8c7e8953c618) by using deterministic tree-sitter extraction instead of LLM-generated content.

## understory

From **understory** ([thecodacus/understory](https://github.com/thecodacus/understory), Apache-2.0):
the SESSION SEED concept (`packages/server/src/mcp/seed.ts`) → `mcp/stdio/session-seed.js`.
Their measured failure was that a client model saw only tool NAMES, so it
answered from its own head and never looked — the knowledge sat on disk,
invisible. The load-bearing detail we took is seeding with what each thing is
ABOUT rather than with filenames, because a question is far likelier to brush
against a described concept than against a file name. Our implementation is our
own code over our own artifacts (`functionality.json` features, `brief.agent.md`);
their project is a personal-memory server and shares no code with ours. Both
build on Karpathy's LLM Wiki idea, credited above.
