# Changelog

All notable changes to aify-project-graph.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/).
Dates are ISO 8601 (YYYY-MM-DD).

## [Unreleased]

_Next-session work lands here until we tag a release._

### 2026-04-26 — upgrade plan v2 executed (M0.5 → M4b)

Co-designed and locked plan at `docs/superpowers/plans/2026-04-25-upgrade-plan.md`,
executed across 12 commits. Goal: flip Codex effective-token regression
into an improvement while preserving Claude Code wins. Theory: cut the
steady token tax (full SKILL.md + verbose live-verb output + repeated
overlay scans) that prompt-cache flattens on Codex but not on Claude.

**Headline measurement** (apg verified-fresh self-bench, 8-task fixture):

| | Pre-upgrade | Post-upgrade |
|---|---|---|
| Win count | 6-2 graph | 6-2 graph |
| Net tokens vs no-graph | −17.3% | **−23.1%** |
| Quality delta | −0.25 | −0.50 (caveat below) |
| Trust gate | ok | ok |
| Tests | 327 | **337** |

Quality delta widened because `graph_packet` is intentionally coarser
than `graph_change_plan`/`graph_consequences`. Skill text now explicitly
tells agents to escalate to depth-verbs when load-bearing — recoverable
through correct usage, not a defect.

**Added**

- **`graph_packet(target, budget=800, live=false)`** — new flagship
  one-shot agent prompt packet. Reads overlay+brief JSON directly
  (no SQL, no `ensureFresh`). Returns fixed-schema markdown:
  `TASK/FEATURE → STATUS → FEATURES → SNAPSHOT → READ FIRST →
  CONTRACTS → TESTS → RISKS → LIVE`. Section caps + token-estimate
  budget. Accepts `feature:<id>`, `task:<id>`, bare ids, or bare
  symbols (auto-resolves via `graph_consequences` with explicit
  `MATCHED VIA:` line). Optional `live=true` enrichment with strict
  2s budget; partial result still useful (`LIVE: timeout` /
  `LIVE: unavailable` markers explicit).
- **Compact Codex SKILL.md** — trimmed from 15330 chars (~3800
  tokens) to ~3100 chars (~780 tokens). Long-form material moved to
  `integrations/codex/skill/references/SKILL-full.md`. Verb order
  + tradeoff guidance + edge provenance + hard rules only.
- **Brief honesty signals**: `SNAPSHOT:` line in `brief.agent.md`
  shows `indexed=<sha> head=<sha>` + `STALE` marker on drift;
  `FEATURES (showing N/M)` indicator when truncated; `DIRTY:` line
  groups source/docs vs scratch/build counts.
- **`brief.plan.md` task counts** — open/in-progress + completed
  count per feature.
- **PATHS pollution filter** — vendor includes (`/vendor/`,
  `/third_party/`, `vk_mem_alloc`, `/glm/`, `/imgui`, etc.) and GLSL
  type-name "calls" (`vec[2-4]`, `mat[2-4]`, samplers) filtered from
  `brief.agent.md` PATHS section.
- **Feature `load:` metric** extended to count INVOKES +
  PASSES_THROUGH edges and file-anchored callers (incoming edges to
  `feature.anchors.files` globs from outside the feature) — fixes
  `load: 0 callers` on C++ class anchors.
- **`graph_consequences` test-adjacency fallback** to curated
  `feature.tests[]` when TESTS-edge / file-adjacency / IMPORTS-edge
  / mention-detection all return zero.
- **`featuresWithInferredTests` overlay-quality metric** — counts
  features that lack curated `tests[]` but have IMPORTS-edge
  evidence from test files.
- **`scripts/verb-latency-profile.mjs`** + artifact at
  `docs/dogfood/latency-profile-2026-04-25.json`.

**Changed**

- **Lean profile grew 3 → 5 visible verbs**: adds `graph_packet`
  (new) and `graph_health` (skill heavily recommends; was hidden).
  Other lean verbs unchanged.
- **Packet trust calculation reuses `computeTrustLevel`** from
  `health.js` so SNAPSHOT trust never disagrees with `graph_health`
  on the same snapshot.
- README + AGENTS bench paragraphs updated with the −23.1% headline.

**Final-bench bugs fixed in close-out**

1. Packet rejected bare symbol/file targets — now auto-resolves via
   `graph_consequences` → matched feature with `MATCHED VIA:` line.
2. Packet trust calc disagreed with `graph_health` (different
   threshold + raw vs trust-relevant count) — now both use
   `getUnresolvedCounts()` + `computeTrustLevel()`.
3. Empty packet sections silently omitted — now render `LABEL: none`
   so agents can distinguish broken-packet from no-data.
4. Packet `enrichLive` crashed on non-JSON `graph_consequences`
   output (NO MATCH plain text) — now degrades gracefully.
5. Symbol-fallback path didn't enrich LIVE because it called
   `graph_consequences` with the resolved feature id (not a symbol)
   — now passes the original symbol when present.

**Documented as known limitation** (not in scope for this round):

- Codex `exec` MCP cancellation — Codex-side behavior, not server.
  Brief-first workflow remains the safe path.



### 2026-04-25 — dogfood + 7 fixes + clean re-bench

Round driven by hands-on dogfood evaluation of the toolset on apg's
own graph. Five user-visible findings → seven fixes (one root cause
revealed two more layers underneath). Final clean bench shows graph
moving from net token overhead to net savings.

**Fixed**

- **Ignore-path basename bug** (`27f4d86`). `pathContainsIgnoredDir()`
  was applying build-dir prefix heuristics (`target_`, `build_`) to
  the FINAL FILENAME segment, dropping legitimate source files like
  `mcp/stdio/query/verbs/target_rollup.js` from indexing. Single
  cause behind 4-of-5 phantom verb-layer failures we initially
  reported as separate bugs. Built-in ignored-dir rules now apply to
  directory segments only; `.aifyignore` glob still matches full
  paths.

- **Planner caller-scope** (`1c32046`). `graph_change_plan` produced
  false `RISK SAFE` on cross-cutting symbols whose cross-file
  imports hadn't fully resolved into call edges. Reproduced cleanly:
  `change_plan("ensureFresh")` returned `0 callers / RISK SAFE`
  despite 31 grep occurrences. Fix: source-occurrence fallback over
  indexed-or-tracked repo files. Now correctly upgrades to `RISK
  CONFIRM`.

- **graph_consequences test-adjacency** (`d918cbc`). Symbols with
  IMPORTS-edge-only test coverage were flagged `no_test_coverage`.
  Root cause traced through three layers: heuristic gap in
  consequences (fixed `430b9bb`) → IMPORTS edge resolver gap (didn't
  help on real repo) → JS/TS extractor flattening relative paths
  instead of resolving against importer directory. Final fix in
  ingest now uses `path.posix` resolution against `filePath`. Real
  repo test files (146 IMPORTS edges from `tests/unit/*`) now emit
  cross-file IMPORTS edges to their imported symbols.

- **graph_report `top_k` not wired** (`1c32046`). Verb output was
  constant ~3kb regardless of `top_k`. Now clamps dirs/hubs/entries/
  docs/community lines: `top_k=5` → 1685 B, default → 5042 B.

- **Broad-query bloat** (`1c32046`). `graph_module_tree(.)` returned
  7043 B; `graph_find(query="graph")` returned 7776 B. Both now
  emit truncation guidance instead of dumping full match sets.
  Module tree dropped to 655 B (-91%); find dropped to 3792 B
  (-51%).

- **SIGNALS honesty caveat** (`430b9bb`). `graph_change_plan` SIGNALS
  line under weak trust now annotates: `(raw indexed edges; weak
  trust may understate caller scope — see source-occurrence count)`
  whenever caller-count is suspiciously low for source-occurrence
  spread.

**Added**

- **Eval artifacts** (`91fc54c`, `c71b9fc`). Three subagent layers
  shipped:
  - `tests/unit/eval/regression-invariants.test.js` — 12 invariants
    locking the 5 findings as semantic regression tests.
  - `scripts/verb-correctness-probe.mjs` — exercises 21 verbs × 3
    inputs each (63 invariant checks, all pass), writes JSON
    snapshot for size-regression tracking.
  - 8-task token-cost benchmark with-graph vs no-graph (graph,
    no_graph, mixed arms across ORIENT / TRACE / CALLERS / IMPACT /
    PLAN / CROSS_LAYER / HEALTH / DEBUG categories).
  - Iterative measurements: `*-postfix.json`, `*-postfix2.json`,
    `*-postfix3.json`, `*-postfix4.json` (final clean-state).

- **graph_impact self-introspection limitation** documented in
  `docs/known-limitations.md` (`9878304`). The verb cannot query its
  own handler symbol because the MCP tool dispatcher reaches it from
  outside the indexed call graph. Accounts for the residual −0.25
  quality delta in postfix4. Architectural; not a fix-blocker.

**Measured (postfix4, verified-fresh state)**

8-task token-cost benchmark on apg's own graph, dogfood-only scope.
Final clean numbers vs pre-fix baseline:

| Metric | Pre-fix | Post-fix |
|---|---|---|
| Win count | 4-4 tie | **6-2 graph** |
| Net token delta vs no-graph | +12.6% (overhead) | **−17.3% (savings)** |
| Quality delta | −0.625 | **−0.25** |
| Trust gate (apg dogfood case) | weak | **ok** |
| Tests | 305 | **327** (326 pass + 1 documented skip) |
| Unresolved edges | 9401 (peak) / 4537 (pre-fix) | **2473** (~2.9× improvement) |
| IMPACT task quality | 3/5 | 5/5 |
| PLAN task quality | 2/5 | 5/5 |

Cross-runtime + scale validation pending separately (Echoes C++
cross-repo + 30k-node scale probe).

**Process learning**

Stale-snapshot reads fooled the postfix3 bench. The bench script
opened a DB connection that hadn't picked up the rebuild. Added
explicit pre-bench verification gates (force rebuild → IMPORTS-count
sanity check → tests_adjacent assertion BEFORE running tasks) that
caught the issue cleanly in postfix4. Recommend the same gates on
any future bench rerun.

### 2026-04-22 — Leiden + class-qualified lookup + 6 new framework plugins

**Added**

- **Leiden community detection** (`ngraph.leiden`, MIT) replaces Louvain,
  matching graphify's design inspiration. Seeded mulberry32 PRNG (seed=42)
  keeps community_ids stable across identical reindexes — an improvement
  over the previous Louvain setup, which was not explicitly seeded.
  Honest bench (`docs/dogfood/communities-bench-2026-04-22.json`) on
  apg's own graph: Louvain 0.72 modularity / 89 communities vs Leiden
  default 0.52 / 310 communities. Raw modularity favors Louvain on
  small graphs; Leiden wins on guaranteed-connected communities and
  graphify parity. Net neutral-to-slightly-negative on modularity,
  structural-guarantee + determinism positive, so we ship Leiden.
  `scripts/communities-bench.mjs` kept for future re-measurement.

- **Class-qualified symbol lookup** (shared `resolveSymbol` helper)
  fixes NO-MATCH on `Class::method`, `A::B::method`, `Module.Class.method`
  that failed the echoes CC lean-half 2×2. Disambiguates by
  `extra.qname` when multiple bare matches exist. Wired into
  `graph_change_plan`, `graph_impact`, `graph_path`,
  `expandClassRollupTargets`. Tests: `class-qualified-lookup.test.js`.

- **6 framework plugins added** (previously only Laravel):
  - `python_web` — FastAPI + Flask, including FastAPI `Depends(fn)` as
    PASSES_THROUGH so DI chains are traceable.
  - `node_web` — Express / Koa / Fastify / Hono, with middleware
    chains emitted as PASSES_THROUGH between handler args.
  - `nestjs` — `@Controller` class prefix + `@Get/@Post/@UseGuards`
    decorator stacks.
  - `rails` — `config/routes.rb` with full `resources :x` expansion,
    `only:`/`except:` filters, `namespace`/`scope` nesting.
  - `spring` — `@RestController` + `@RequestMapping` + `@GetMapping`
    etc. on Java and Kotlin sources.
  - `cpp_frameworks` — Qt4/5 signal/slot connects + `emit sig()` +
    Google Test (TEST/TEST_F/TEST_P) + Catch2 (TEST_CASE/SCENARIO).
  Each plugin auto-detects via the repo's dependency manifest; no-op
  on repos that don't use the framework. Tests: `frameworks.test.js`
  (8) and `cpp-frameworks.test.js` (6).

**Deps**

- Added: `ngraph.graph`, `ngraph.leiden`.
- Removed: `graphology`, `graphology-communities-louvain`.

### 2026-04-21 — provenance consumption + P0 state-loss fix

**Added**

- **Per-edge `provenance` surfaced across read verbs.** Schema v4 producer
  side tagged edges EXTRACTED (AST), INFERRED (heuristic/framework), or
  AMBIGUOUS (external fallback) in `92af81a`. Consumer side completed
  this round: `graph_impact`, `graph_callers`, `graph_callees`,
  `graph_neighbors`, `graph_pull` (relations layer), and `graph_path`
  now carry the field. Rendered edge lines show `prov=INFERRED|AMBIGUOUS`;
  EXTRACTED stays silent to keep output terse.
- New regression tests: `tests/unit/query/provenance-surface.test.js`
  (4) and `provenance-surface-pull-path.test.js` (2).

**Fixed**

- **P0: 500-cap `manifest.dirtyEdges` state loss across incremental runs.**
  Diagnosed 2026-04-21 via `scripts/diagnose-convergence.mjs` — not a
  convergence algorithm drift, a state truncation. Each run dropped any
  unresolved edges past row 500 when carrying them forward. Fix shape
  (dev-approved): new `.aify-graph/dirty-edges.full.json` sidecar holds
  the authoritative complete list; the 500-row `manifest.dirtyEdges`
  stays as a breakdown-query sample for `graph_status`/`graph_health`.
  Orchestrator reads sidecar first, falls back to manifest sample for
  older graphs. Unblocks the git post-commit hook (task #100) — force
  rebuilds are no longer the only path to convergence.
  Tests: 4 new sidecar unit tests. Full suite 230 green.

**Added**

- **Git `post-commit` hook** (`scripts/install-hooks.mjs` + `scripts/hooks/post-commit`
  + `scripts/graph-reindex-hook.mjs`). Installs a background-executing
  hook so commits keep the graph and briefs synced with HEAD without
  blocking. Refuses to overwrite foreign hooks without `--force`;
  `--remove` cleanly uninstalls ours. 6 new integration tests.
- `graph_status.unresolvedBy` now exposes both `total` (authoritative,
  from `dirtyEdgeCount`) and `sample_size` (rows in the 500-row
  breakdown slice). Percentages derived from byRelation/byLanguage sum
  to `sample_size`; `total` tells you the true scale even when sampled.

**Fixed**

- `tests/integration/mcp-resources.test.js` Windows EBUSY flake:
  teardown now waits for child exit and retries rmdir, so repeated
  runs don't fail with transient file-lock errors.



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
