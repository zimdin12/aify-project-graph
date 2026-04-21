# Changelog

All notable changes to aify-project-graph.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/).
Dates are ISO 8601 (YYYY-MM-DD).

## [Unreleased]

_Next-session work lands here until we tag a release._

## 2026-04-22 — graph-as-map evolution

The graph moved from "searchable database" to **map-for-agents**. Three
new verbs, one stronger discipline (mixed-mode), and the first round of
correctness fixes the static-brief + live-verb surfaces were silently
contradicting each other on.

### Added

- **`graph_consequences(target)`** — flagship traversal verb answering
  *"what breaks if I touch X?"* across code + feature + contract + task
  + test + git-history layers in one call. Accepts a symbol name, a
  repo-relative file path, OR a tracker task id. Output carries
  `contracts_potentially_affected`, `features_touching`,
  `open_tasks_on_those_features` + `top_related_tasks[3]`,
  `tests_adjacent`, `last_touched` (with `days_ago`), `spec_docs`,
  `risk_flags` (keyed: `orphan_anchor`, `no_test_coverage`,
  `cross_feature_boundary`, `task_overhang`, `high_fan_in`,
  `contract_binding`).
- **`graph_health()`** — single-call synthesis of "is the graph usable
  right now?" Returns one-line summary + structured fields (trust
  level, unresolved-edge count, staleness vs HEAD, overlay validity).
  Replaces the 3-call `graph_status` + `graph_index` + brief TRUST
  parse workflow that was disagreeing with itself.
- **Feature coverage gradient** in `brief.json.features[].valid[].coverage`
  — composite health tier (🟢 healthy / 🟡 watch / 🔴 risk) synthesized
  from anchor_health × task_count × contract_count.
- **Per-feature tasks in brief.json** — `task_count` + up to 10
  `tasks[]` per feature so programmatic consumers (`/graph-walk-bugs`,
  future graph-lint) don't have to re-parse `tasks.json`.
- **`graph_indexed_at` + `graph_commit` at brief.json top level** —
  reads from `manifest.indexedAt` so agents can detect "brief is fresh
  but graph is N commits behind" without forcing cache churn.
- **Overlay JSON schemas** — `docs/schemas/functionality.schema.json`
  and `docs/schemas/tasks.schema.json` (draft-07). Loader stays
  permissively-normalized; schemas are for external validators.
- **Native-module preflight self-heal** (`mcp/stdio/preflight-native.js`).
  Platform-mismatched `better-sqlite3` binaries (Windows / WSL flip)
  auto-rebuild on server startup.
- **Multi-agent team docs** in AGENTS.md (concurrent reads safe,
  writes serialized two-tier, 3-minute cross-process lock retry).
- **`graph-build-all` auto-offers `/graph-build-tasks`** when a tracker
  MCP is detected.
- **Laravel middleware extraction** — `$middleware` + `$middlewareGroups`
  from Kernel.php, emits `PASSES_THROUGH` edges through the route →
  middleware → controller chain so `graph_path` + `graph_consequences`
  trace request flow end-to-end.
- **`PASSES_THROUGH` relation** supported across every traversal verb
  (`graph_callees`, `graph_callers`, `graph_file`, `graph_neighbors`,
  `graph_path`).

### Changed

- **Brief TRUST count reads `manifest.dirtyEdgeCount`** instead of
  `edges WHERE confidence < 1.0` (different thing — heuristic edges).
  Brief now agrees with `graph_status` and `graph_health` on the same
  state; `computeTrustLevel()` is the shared helper so they cannot drift.
- **`graph_find` tokenizes compound queries** server-side. Previously
  `"pressure vacuum gas"` returned empty because the full string was
  one literal match; now it's split on whitespace, each term run, and
  results unioned. Full phrase still preferred when it matches.
- **IMPORTS extractor** (JavaScript + TypeScript) — named imports now
  emit both the source AND source.member as targets. Previously only
  compound targets were emitted and none resolved, so 99% of JS files
  produced zero IMPORTS edges.
- **Resolver — file-path suffix match for IMPORTS** — C++
  `#include "core/Engine.h"` now resolves to the File node with
  `file_path` ending `/core/Engine.h`. Biggest lever for C++ repos
  (63% of unresolved refs on the echoes repo were this shape).
- **Resolver — local-scope REFERENCES silently dropped** when the
  bare lowercase target doesn't match any node label. Previously
  inflated unresolved count by 85% on PHP repos; now unresolved is
  honest.
- **Dashboard large-graph guard** — graphs >3000 nodes switch to
  instant `grid` layout with a banner, instead of pegging the browser
  main thread with `cose`.
- **Dashboard CDN removed** — Cytoscape + 3d-force-graph now served
  from `node_modules` via `/vendor/*` routes; no more Edge cold-load
  hangs on unpkg.
- **Codex skills: `trigger:` frontmatter removed** from all 11 files.
  It's not a documented OpenAI Codex skill field; was dead metadata.
- **In-process write-lock queue** (`mcp/stdio/freshness/lock.js`) +
  cross-process retry budget bumped from ~9s to ~3min. Fixes
  "Lock file is already being held" on concurrent verb calls.
- **Skill prompts**: codified **MIXED-mode** as the winning pattern
  (graph for orientation, Read/Grep for details, skip graph entirely
  for line-level audits). Added hard rules for mining overlay links
  (contracts, tasks, depends_on) before planning, reaching for
  `graph_impact` on cross-cutting tasks, and verifying line-number
  citations in-session before using them.

### Fixed

- `graph_status.unresolvedEdges` now reports `manifest.dirtyEdgeCount`
  (true count) rather than the 500-capped sample array length.
- `graph_status` nodes/edges counts read live from SQLite so they
  agree with `graph_report`.
- `graph_consequences` on class names de-duplicates forward
  declarations — definition files are primary, forward decls surface
  under `matched.referenced_in[]`.
- Overlay loader preserves `contracts[]` (was silently dropped in
  `normalizeFeature`).
- `.codex_tmp/` and `worktrees/` now in `IGNORED_DIRS` — sandbox
  scratch no longer pollutes the graph.
- Verb response envelope surfaces a `_warnings: [...]` entry when the
  graph is stale (indexed commit != HEAD).
- `graph_index` response now carries `unresolvedAnchors: {checkedFeatures, brokenFeatures, sample}`
  so the validation pass is visible on success too.
- `graph-brief.mjs` prints a loud ⚠ block for broken anchors and a ✓
  line for clean overlays.

### Known limitations (documented; not regressions)

See `docs/known-limitations.md`:
- `graph_callers` is function-granular. For per-line callsite audits
  Grep wins by schema.
- Incremental indexing does not fully converge to `graph_index(force=true)`
  on unresolved-edge count. Force-rebuild is recommended after large
  refactors.
- Multi-repo live verbs require one MCP registration per repo
  (the server is cwd-bound at launch). Static briefs work cross-repo.
- Non-interactive `codex exec` may cancel live MCP calls. Use
  interactive Codex or rely on static briefs there.

### Tests

212 unit + integration tests green, stable across multiple runs.
