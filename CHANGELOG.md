# Changelog

All notable changes to aify-project-graph.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/).
Dates are ISO 8601 (YYYY-MM-DD).

## [Unreleased]

_Next-session work lands here until we tag a release._

## 2026-04-22 (post-bench) — post-mortem fixes

Echoes manager's 39-agent post-mortem surfaced several items I missed on
first read. Shipping the gap closures here:

### Added

- **`graph_health.briefStaleVsManifest`** — boolean + summary-string signal
  when `brief.json.graph_indexed_at` diverges from `manifest.indexedAt`.
  Fixes the "brief says weak, health says strong" same-moment disagreement
  that the 39-agent bench flagged (different inputs, same thresholds —
  not a threshold bug, a cache-vs-live drift). Verdicts now include
  `brief-stale: regenerate with graph-brief.mjs` when detected.
- `docs/known-limitations.md` entry on the brief-vs-live drift with the
  new workaround.

### Fixed

- Clean-clone regression from `1fa037a`: 12 untracked fixture files under
  `tests/fixtures/ingest/tiny-laravel-middleware{,-conflict}/` now tracked
  in git. Previously 7 tests passed on dirty checkouts + failed on clean.
- AGENTS.md + README.md stale claim that "Codex/OpenCode don't load skill
  files" — Codex has shipped skills since commit `7a09dcb`. Corrected to
  "Claude Code + Codex both load skills; OpenCode skips."
- AGENTS.md verb count `19 → 21` (graph_consequences + graph_health added
  earlier this session).

### Still open from manager's post-mortem (NOT fixed this round)

- **Incremental-indexing convergence regression** (manager's P0). Same
  commit produces different `dirtyEdgeCount` on incremental vs force-rebuild
  (500 vs 5424 on echoes). Documented in known-limitations; fix pending
  root-cause investigation.
- **15 never-invoked verbs** across 39 agents — manager's cognitive-surface
  argument for deprecation. Separate design pass.
- **Cross-repo bench** to validate mixed-mode findings outside Echoes.
  Manager's methodology caveat; needs their cycles, not a code fix.

## 2026-04-22 (late) — graph_consequences correctness + Claude-Code-scoped bench

Echoes manager ran three deep-test rounds + one 2×2 (totaling 39 agents) this
day. Two correctness bugs in `graph_consequences` shipped as fixes; the
behavioral bench findings are Claude-Code-scoped (Codex re-bench pending).

### Added

- **`graph_consequences` — task→file reverse lookup.** New third anchor_match
  path: `anchor_match: 'task'`. Features now get surfaced via tasks that
  reference the target file (`task.files_hint[]` exact/suffix match — high
  confidence; `task.title` substring match on basename ≥8 chars or CamelCase
  — low confidence). Each task hit carries `{id, match}` so consumers can
  filter by confidence tier. Previously: feature was only reached via direct
  anchor; tasks that mapped a file to a feature via task.features[] were
  invisible.
- **`graph_consequences.co_consumer_files[]`.** When the target file's
  features anchor other files too, they're surfaced as peers with
  `{file, via_feature}`. Echoes manager's bench flagged
  `graph_consequences("sharc_update.comp.glsl")` missing `sharc_resolve.comp.glsl`
  — this surfaces the peer set explicitly for refactor planning.

### Fixed

- Race between `graph_consequences` and task-based feature links was
  undefined for files not anchored in `functionality.json`. Affected files
  returned empty `features_touching` / `contracts_potentially_affected` /
  `open_tasks_on_those_features`. Now resolves through the task layer.

### Benchmark scope (important caveat)

Two behavioral findings this round are **Claude Code–scoped**, not universal:
- "Full manifest is cheaper than lean" — measured only on Claude Code + Opus
- "Full SKILL.md prose drives 3.3× more graph use" — same scope

The lean profile remains as-is for Codex/OpenCode until we have a Codex-side
2×2 re-run. Do not act on these findings for other runtimes without
confirmation.

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
