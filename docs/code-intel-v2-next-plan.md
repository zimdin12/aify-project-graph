# Code-Intel v2 — consolidated NEXT-PLAN backlog (everything not yet done)

> ⚠️ **STALE BACKLOG (2026-05-08 snapshot).** Most of this has since shipped —
> do NOT read it as "remaining work." Current state: `CHANGELOG.md` +
> `docs/reference-pull-and-audit-2026-06-12.md`. Kept for provenance only.

_2026-05-08. The single source of truth for remaining work, so nothing from the build round + reference reviews gets lost. Pulls together: not-done layers from the master plan, the original JS-resolution waves we deferred when we pivoted to C++, the 4 A/B known issues, the dashboard research, the "what we missed" sweep, and the agent-UX deep-dive._

DONE so far (for context): L0 win32 hygiene · L1 clangd foundation · L2a clangd→LSP_VERIFIED edges · L2b trust banner + unity expansion · L3 readiness-gated reliable refs · L4 call/type hierarchy · L5 C++↔GLSL shader bridge · installed both runtimes · A/B validated. See `code-intel-v2-status.md`.

> **UPDATE 2026-05-31 — most of this backlog has shipped.** Completed and verified: **P0-1, P0-2, P0-5, P0-6** (P0-3 partially — `--query-driver` landed; the WSL-clangd diagnostics path is the live follow-up); **P1-1, P1-2, P1-3, P1-4, P1-5**; the **P2 dashboard analytics layer** (overview/hotspots/cycles verbs + `graph_digest` front door + shader sub-view + provenance ribbon — "ends the island"); and the holistic-review cohesion fixes **R1 (C1/I1/I2/I3) + R2a/R2b** (single `storage/taxonomy.js`, neighbors-wiring, unified trust vocabulary, surface trim to 30 listed tools). Items below are annotated **✅ DONE** where landed.

> **UPDATE 2026-06-01/02 — another large wave shipped (see the "Shipped 2026-06-01/02" section below for the narrative + commits).** Now also DONE: **P0-3** (opt-in `APG_CLANGD_WSL` — real Windows diagnostics, no longer just `--query-driver`); **P1-6** (structural-vs-cosmetic change fingerprint → SKIP/PARTIAL/FULL); **P3-1/P3-2/P3-4** (JS/TS import resolution + import-evidence CALLS + packet skeletonize); **P4-1** (default 15-verb profile + `APG_MCP_TOOLS` ablation allowlist) and **P4-2** (staleness banner primitive); the **P5 hardening bundle** (P5-1…P5-5); plus net-new work not previously in the table — the **dashboard rebuild** (navigable group-box Map), the **agent front door** (adaptive packet token budget + `graph_packet`-first routing + KNOWN LIMITS), **freshness self-heal** (`graph_index` in default surface + commits-behind warning + opt-in `APG_AUTO_REINDEX` + post-commit hook), and the **semantic layer** (archetype auto-naming, `graph_tour`, `graph_search mode:semantic` with pluggable embeddings). The **genuinely-remaining live backlog**: **P3-3** (TS/JS LSP provider), remaining **P2 dashboard polish**, remaining **P4 / P5-none-left / P6**, and a short list of new deferred items (bundled embedding model, agent-eval A/B harness, dashboard `graph_tour` rendering, holistic-review advisories) captured in **"Remaining / deferred 2026-06-01/02"** below.

Source tags: **[KI]** known-issue/bug · **[MP]** master-plan layer · **[SYN]** original reference-borrow waves · **[DASH]** dashboard research · **[MISS]** "what we missed" sweep · **[UX]** agent-UX deep-dive. License: codegraph/graphify/understand-anything MIT (reimplement w/ attribution); agent-code-intel UNLICENSED (patterns only).

---

## P0 — Correctness / known issues (fix first)

| # | Item | Source | Effort | Notes |
|---|---|---|---|---|
| P0-1 ✅ DONE | **Cold `graph_collect_code_intel` drops the MCP stdio connection** (`-32000`) — ~53s cold index exceeds host tool-call timeout. Time-budget the collect (~40–45s), return `partial` + resume token; optionally a separate fast "warm-index" call. | [KI] | M | Live verbs are the unaffected primary path. The marquee collect flow is unusable via MCP until fixed. |
| P0-2 ✅ DONE | **Expand TEST unity TUs** in `compile-db.js` (engine unity expands, test ones don't) → test→engine callers currently missing from `graph_callers`. | [KI] | S | Gate first-party to include `tests/`. |
| P0-3 ✅ DONE | **Windows clangd sysroot/includes** — WSL/Linux-built `compile_commands.json` has Linux include/sysroot paths absent on Windows → bogus diagnostics/hover. **Shipped opt-in `APG_CLANGD_WSL`** (`b7c15c7`): runs clangd UNDER WSL against the ORIGINAL Linux DB, file URIs round-trip host↔WSL at the LSP boundary (`hostToWsl`/`wslToHost`). Verified on echoes `Engine.cpp` (90 bogus → 15 real diagnostics; stdlib resolves). `auto` mode engages only on a foreign DB. | [KI] | M | refs/hierarchy stay trustworthy where fresh/exhaustive; this now also unlocks diagnostics/hover quality. Caveat: full-DB cold-index latency under WSL is the same caveat the Windows path carries. |
| P0-4 ✅ DONE | **`graph_callers` `[lsp✓]` surface parity** — confirm the marker+TRUST line render whenever LSP caller edges exist (verified on `GPU::is_valid`; tester's case had none post-collect due to P0-2). Add a regression test. | [KI] | S | Likely already correct; verify + lock. |
| P0-5 ✅ DONE | **C++ virtual-override synthesized `CALLS` edges** (`A::method → B::method` for `class B : A`, capped per class, `provenance:'INFERRED'`). Fills the gap clangd leaves: clangd resolves a `base*->virt()` callsite to the *declared* type's method, not runtime overrides. Game engines are vtable-heavy (ISystem/IRenderer/ISimDomain). | [MISS]#1 | M | codegraph `callback-synthesizer.ts`. **Heed: partial dynamic-dispatch coverage is WORSE than none** — close flows end-to-end. Tag INFERRED, never LSP_VERIFIED. |
| P0-6 ✅ DONE | **Hermes installer toolset gotcha** — Hermes CLI profiles filter MCP tools by `platform_toolsets.cli`; a server in `mcp_servers` alone connects but its tools are INVISIBLE in CLI sessions. Add `aify-project-graph` to the toolset list, not just `mcp_servers`. Verify our current Hermes install actually exposes the tools in a CLI profile. | [UX]C7 | S | codegraph `installer/targets/hermes.ts`. Our tester reached tools, but confirm under CLI profiles. |

---

## P1 — High-value capability (biggest agent leverage)

| # | Item | Source | Effort | Notes |
|---|---|---|---|---|
| P1-1 ✅ DONE | **MCP `initialize` server-instructions** — a tight intent-routed playbook returned on initialize (every host injects it into the system prompt once/session). Intent table (deletion-safety→code_intel_*; what-breaks→consequences/impact; cross-layer→pull; orient→brief+packet; "trust LSP_VERIFIED, don't re-grep"), common chains, anti-patterns. The one channel that reaches Hermes + Claude identically. | [MISS]#4 / [UX]C1 | S | `server.js:690` currently returns serverInfo only. Canonical home for trust-spine guidance now stuck in skill files Hermes may not load. |
| P1-2 ✅ DONE | **`graph_trace(from→to)`** — whole call path in one call, each hop body inlined (`cat -n`), call-site line, dynamic-dispatch bridges annotated; **smart failure path**: when no static path, inline both endpoints' bodies + callers/callees + destination file-mates instead of 404. Path-proximity pairing for duplicate names; MAX_HOPS guard. | [UX]C4 | M/L | codegraph `handleTrace`. High differentiation for C++ dynamic dispatch. Failure-path inlining is borrowable even before edge synthesis. |
| P1-3 ✅ DONE | **`graph_explore(symbols[])`** — multi-symbol verbatim-source bundler in ONE budget-capped call, grouped by file, `cat -n` line numbers, repo-size-scaled budget, "treat as already Read" framing. Kills the Read-spiral. | [UX]C3 | M | codegraph `handleExplore` + `getExploreOutputBudget`. |
| P1-4 ✅ DONE | **`graph_explain_diff(range)` / change-explain verb** — keyed on a git diff/PR (not a symbol): changed components → 1-hop affected → affected layers → risk score; emit `diff-overlay.json` for the dashboard. Reverse of `consequences` (which is forward-from-symbol). Fills the reviewer/PR-impact gap. | [MISS]#5 / [UX]A1 | M | understand-anything `understand-diff` + agent-code-intel `changed_file_diagnostics`. Reuses our impact/layer/edge machinery. |
| P1-5 ✅ DONE | **Generated-file down-ranking** — path-suffix classifier (`.pb.cc/.pb.h`, `moc_*`, `ui_*`, `*_generated.h`, `qrc_*`, `*.gen.h`); generated nodes stay reachable but rank LAST when a hand-written symbol shares the name. Add `generated:true` hint. | [MISS]#2 | S | codegraph `generated-detection.ts`. High hit-rate in game projects (protobuf/Qt/FlatBuffers/reflection codegen). |
| P1-6 ✅ DONE | **Structural-vs-cosmetic change fingerprint → tiered rebuild** (SKIP/PARTIAL/FULL). Shipped `a665e99`: `fileStructuralFingerprint()` hashes the body-INSENSITIVE shape (symbol sigs/members/decorators + the complete outgoing ref-target set). Body-only edit → COSMETIC → zero re-resolution. Pairs with the incremental watcher. | [MISS]#3 | M | understand-anything `fingerprint.ts`+`change-classifier.ts`. Turns 30s incrementals into 200ms on big game repos. |

---

## P2 — L6 Dashboard (the layer skipped last round) + make-it-not-an-island

> **✅ Largely SHIPPED (2026-05-31).** The "not-an-island" core landed: analytics is now exposed as VERBS — `graph_overview`/`graph_hotspots`/`graph_cycles` (callable) behind the single `graph_digest` front door (the dashboard's whole analytic value in ~1–2k tokens), plus the shader sub-view + provenance ribbon and the dashboard upgrade. Remaining P2 polish (async/self-repairing layout, export, idle overview panel, overlay re-anchor) stays in the live backlog — marked per-row below.

The dashboard was a browser-only island that shipped up to 25k nodes raw and whose computed analysis (communities/layers/hotspots) no verb returned. Full teardown + plan in the dashboard research (agent `a377c0e6bb01e2c82`).

**Architecture rule:** put aggregation/hotspot/cycle/digest logic in ONE shared `mcp/stdio/intelligence/analytics.js` that BOTH dashboard endpoints AND new MCP verbs call (graphify's pattern) — so viz and agent surface never drift.

| # | Item | Source | Effort | Value |
|---|---|---|---|---|
| P2-1 ✅ DONE | **Overview→drill-in with community/layer aggregation** — shipped via the **dashboard rebuild** (`3eb55f8` + semantic-layer follow-ups): navigable group-box **Map** with drill-in, **by-archetype / community / directory** grouping, and Tree/Flow/Force/Shader views in 2D + 3D. Stops shipping 25k raw nodes; `/api/overview` returns aggregated clusters. | [DASH]A1 | M | **Highest** — the only legible front door at 13k files. understand-anything `aggregateLayerEdges`/`deriveContainers`/Louvain. |
| P2-2 | **Blast-radius highlight mode** — `/api/impact/:id?depth=N` (reuse impact/consequences) → `{changed, affected}`; frontend toggle colors changed=red/affected=amber/fade rest. | [DASH]A2 | M | Highest *action* value. understand-anything `DiffToggle`. Pairs with P1-4 overlay JSON. |
| P2-3 ✅ DONE | **Shader-binding sub-view** — edge-relation filter group for `DECLARES_BINDING`/`LOADS_SHADER`; "Shader map" preset showing ShaderBinding nodes + CPU declarers/loaders; distinct color + legend + node shape. | [DASH]A3 | S | Bespoke game value; edges already exist. |
| P2-4 ✅ DONE | **Provenance ribbon upgrade** — code edges solid (LSP_VERIFIED) vs dashed (heuristic); `lsp-verified` pill; top-line "X% of call edges LSP-verified." | [DASH]A4 | S | Trust signal unique to C++ noisy call graphs. |
| P2-5 | **Pathfinder** — `/api/path?from=&to=` bidirectional BFS, clickable numbered chain. | [DASH]A5 | M | understand-anything `PathFinderModal`. |
| P2-6 | **Idle Project-Overview panel** — replace "click a node" with stats + top-10 god nodes + type/community distribution bars. | [DASH]A6 | S | understand-anything `ProjectOverview` + graphify `god_nodes`. |
| P2-7 | **Async + self-repairing layout** — move positioning off-thread (worker); orphan-edge/missing-dim repair pass + banner; consider elkjs for the (small) drilled-in cluster view. | [DASH]B1 | M | understand-anything `repairElkInput`. |
| P2-8 | **Export** — PNG/SVG + filtered-graph JSON (re-loadable). + keyboard shortcuts; richer in-node encoding; cycle list. | [DASH]B2/B3/C1/C2 | S each | JSON export is the useful half. |
| P2-9 ✅ DONE | **Expose analytics as VERBS + a digest** (ends the island): `graph_overview` (cluster map), `graph_hotspots` (god nodes), `graph_communities`/`graph_layers`, `graph_cycles`, and a `graph_digest` / `/api/digest` token-budgeted text summary (layers, hotspots, shader-binding counts, provenance %, tightest cycles, community bridges). | [DASH]§4 | M | graphify `serve.py` resources + `_subgraph_to_text`. One verb gives an agent the dashboard's whole analytic value in ~1–2k tokens. |
| P2-10 | **Overlay repair** — sand_castle `functionality.json` anchors broken (0/9) → `graph_packet` degraded there. Re-anchor / regenerate. | [MP] | S | |

---

## P3 — JS/TS resolution (original waves we deferred when pivoting to C++)

Still real: the JS graph has **~1476 fixable + 87 IMPORTS** unresolved edges (`unresolved-categorization.js` scoreboard). We did W1/W2 (=L0) and W6 (install) but NOT these:

| # | Item | Source | Effort | Notes |
|---|---|---|---|---|
| P3-1 ✅ DONE | **IMPORTS: extension-probe + tsconfig path-aliases + `require()` pass** — shipped `fee3309` (`ingest/import-resolution.js`): extension-probe against the git fileset, tsconfig/jsconfig path aliases (nearest-enclosing, JSONC-tolerant, load-bearing leading-`./` strip), require() CJS pass. Additive (zero regression). | [SYN]W3 | S→M | understand-anything `extract-import-map.mjs`. |
| P3-2 ✅ DONE | **CALLS/REFERENCES import-evidence resolution** — shipped `fee3309` (`ingest/js-import-evidence.js`): per-file localName→source map; unique-match-only (INFERRED) guarded by COMMON_NAMES + language-family + no-doc-node + bail-on-ambiguity. **Honest:** this repo can't move the `fixable:*` headline (explicit extensions, method-call-heavy); proven on a synthetic create-next-app fixture (alias + extensionless + require() resolve, dup-call narrowed). Helps the many JS/TS projects that DO use aliases. | [SYN]W4 | M | codegraph `name-matcher` + graphify Tier-A. |
| P3-3 ⬜ TODO | **TS/JS LSP provider** (`ts-tsserver.js` mirroring cpp-clangd) — semantic backstop for JS CALLS name-matching can't disambiguate. The clangd spine generalizes to it. **STILL REMAINING.** | [SYN]W5 | M | typescript-language-server `--stdio`; reuse importer + resolveServer chain. |
| P3-4 ✅ DONE | **`packet.js` skeletonize-before-drop** — shipped `fee3309`: collapse dir-prefix-shared list items + keep header+count before dropping tail; never drops the `target` READ-FIRST section. | [SYN]W7 | S→M | codegraph adaptive sizing. |

---

## P4 — Ergonomics / polish (cheap, compounding)

| # | Item | Source | Effort |
|---|---|---|---|
| P4-1 ✅ DONE | **Repo-size / profile-adaptive tool gating** — shipped `0ffb838`: `default` profile (15 intent verbs) is now the actual default; `full` (30) is explicit opt-in; all other verbs stay callable-by-name but unlisted. `APG_MCP_TOOLS` env allowlist for A/B ablation (truly absent from ListTools). | [UX]C5 | S |
| P4-2 ✅ DONE | **Soft per-file staleness banner** (vs our current hard blocker) — shipped `f3f982f` (`query/staleness-banner.js`): one consistent `⚠ stale: … Read these directly` line, flagging the stale files referenced in *this* response. | [UX]C6 | S |
| P4-3 | **Intent-steering tool descriptions** — designate ONE primary verb ("call FIRST"); each description names the better alternative for adjacent intents; "returned source is Read-equivalent — don't re-open." | [UX]C8 / [MISS]#7 | S |
| P4-4 | **`noValueAdded` flag + per-response telemetry block** — `{noValueAdded:true}` when freshness≠fresh AND empty (distinguishes "verified-none" from "not-ready"); `telemetry{latencyMs, freshness, callCounts}`. | [MISS]#6 | S |
| P4-5 | **Onboarding upgrades** — ordered guided **tour** (entry-point-first numbered path) + **complexity-hotspots** "approach carefully" section in briefs/`graph_onboard`. | [UX]A3 | S/M |
| P4-6 | **`graph_explain` neighborhood-walk mode** + **no-match→suggest graph-derived near-names** across all symbol-keyed verbs. | [UX]A4/A5 | S |
| P4-7 | **Per-phase progress reporting** (`[Phase N/7]…`) in long-running build skills. | [UX]A6 | S |

---

## P5 — Hardening / hygiene

| # | Item | Source | Effort |
|---|---|---|---|
| P5-1 ✅ DONE | **Pre-parse JSON size cap** on `.aify-graph/*.json` before `JSON.parse` — shipped `18b5bff` (`util/json.js` `readJsonCapped`, 64MiB default / `APG_JSON_MAX_BYTES`, stat-checks before parse; routed overlay/manifest/categorization reads). _SSRF kit deferred — no fetch path lives yet._ | [MISS]#8 | S |
| P5-2 ✅ DONE | **Cross-language-family phantom-edge drop** — shipped `18b5bff`: `filterByLanguageFamily` + `HARD_GATED_RELATIONS`; C++↔GLSL `LOADS_SHADER` bridge is an explicit documented exemption. Real graph: 5615 typed edges, 0 cross-family. | [MISS]#10 | S |
| P5-3 ⬜ TODO | **Hub-as-transit BFS skip** in path/trace — don't expand *through* high-degree hubs (`max(50,p99)`); they can be endpoints, not waypoints (avoids `A→Logger→B` noise). **STILL REMAINING** (P5-3 was NOT in the shipped P5 bundle). | [MISS]#11 | S |
| P5-4 ✅ DONE | **clangd child process hygiene** — shipped `18b5bff`: `lsp-client` polls parent liveness (`process.kill(ppid,0)`), shuts the clangd child if parent dies (`APG_PPID_POLL_MS=0` opts out); watcher now filters ANY ignored path segment (nested node_modules/build/.claude/worktrees) before registering. | [MISS] meta | S |
| P5-5 ✅ DONE | **Worktree redirect** (stronger than a notice) — shipped `18b5bff`: `detectWorktree` + `resolveGraphRoot` redirect `.aify-graph` to the main checkout when run in a linked worktree lacking its own graph (`APG_NO_WORKTREE_REDIRECT=1` opts out). Real-verified. | [UX]A6 / [SYN]secondary | S |

---

## P6 — New analysis insights / deferred research

| # | Item | Source | Effort | Verdict |
|---|---|---|---|---|
| P6-1 | **Circular-dependency detection verb** (file-level, bounded `simple_cycles`, rotation-dedup, tightest-first). | [SYN]secondary / graphify | S→M | Worth it (C++ header tangles). |
| P6-2 | **Peripheral→hub anomaly detector** — flags a low-degree node unexpectedly reaching a hub (layering-violation smell). | [MISS]#9 | S→M | New insight verb. |
| P6-3 | **Two-hash manifest** (AST vs semantic) — re-run LLM intelligence only on content-changed files. (Partly addressed by L3 readiness, NOT the manifest split.) | [SYN]secondary | S→M | Cost/perf. |
| P6-4 | **Semantic-batching neighborMap feeding** for the intelligence layer (import-neighbors + their exported symbols into each summary call); port the neighborMap even without Louvain. Info-vs-Warning discipline. | [UX]A2 | S (neighborMap) / L (Louvain) | Quality win for summaries. |
| P6-5 | **`#include`→header file-edges + typed-member-pointer caller resolution** — verify our clangd path yields these; the `m_alg->Process()` typed-member case is the subtle C++ one. | [MISS]#13 | S to verify | |
| P6-6 ⏳ PARTIAL | **Embedding / NL semantic search** (cosine over per-node embeddings, type filter) — **shipped pluggable** (`b76ff8a`/`2ba60fa`): `graph_search(mode:"semantic")` over a precomputed embeddings sidecar; OpenAI-compatible endpoint via `APG_EMBED_ENDPOINT`/`APG_EMBED_MODEL`/`APG_EMBED_API_KEY` (local Ollama or cloud); build opt-in `scripts/build-embeddings.mjs`; degrades to lexical + hint. **Remaining: a true BUNDLED local embedding model** (currently external/pluggable on purpose — see deferred list). | [MISS]#12 / [UX] | L | |
| P6-7 | **Self-bundling bootstrap** (atomic staged dep install) for "just works" plugin install both runtimes. | [SYN]secondary | M/L | |

---

## Shipped 2026-06-01/02 (this session)

Four workstreams landed on top of the items already marked ✅ above (commit refs in `git log`):

1. **Dashboard rebuild** (`3eb55f8` + semantic follow-ups `039fbda`/`59790da`). Navigable **group-box Map** with drill-in; grouping by **archetype / community / directory**; **Tree / Flow / Force / Shader** views; **2D + 3D**. Replaces the 25k-raw-node island (closes **P2-1**). Also fixed a latent bug: `community_id` lives in `extra` JSON, not a column.
2. **Agent front door** (`d7c437f`/`c5b46c1`/`776fd3b`/`f3f982f`). **Adaptive packet token budget** (repo-size monotonic tiers keyed on `manifest.nodes`; precedence arg > `APG_PACKET_BUDGET` > tier — kills god-file truncation); **`graph_packet`-first routing** + an honest **KNOWN LIMITS** block in `server-instructions.js` (dynamic dispatch / script callbacks / cross-lang not synthesized); **staleness banner primitive** (`query/staleness-banner.js`). (Closes **P4-2**; reinforces **P4-1**.) Spec/plan: `docs/superpowers/{specs,plans}/2026-06-01-agent-front-door*`.
3. **Freshness self-heal** (`82d9961`/`b49855f`/`0c860f3`/`2ecbf01`). `graph_index` now in the **default tool surface**; central staleness warning reports **commits-behind** + a self-heal hint; opt-in **`APG_AUTO_REINDEX=1`** refreshes a behind-HEAD graph before the read handler runs; optional **post-commit reindex hook** installer (`scripts/install-graph-hook.mjs` + `scripts/reindex.mjs`). Addresses the 2026-06-01 the field fleet A/B where a stale graph was worse than none for managed workers. _Overlay-build gap is a per-repo data action — run `/graph-build-functionality` on the target repo, not tool code._ Spec/plan: `docs/superpowers/{specs,plans}/2026-06-01-graph-freshness-self-heal*`.
4. **Semantic layer** (`a0cfde7`/`039fbda`/`e07b3f9`/`2ba60fa`/`b76ff8a`). **Archetype auto-naming** (`intelligence/archetypes.js`; game-dev keyword→archetype; wired into `computeOverview` → `graph_overview`/`graph_digest` + the dashboard "by archetype" Map); **`graph_tour`** verb (ordered N-step orientation: entrypoints → archetype regions → hotspots → cross-subsystem flows; `focus` narrows; full-listed not default); **semantic search** `graph_search(mode:"semantic")` over a precomputed sidecar, **pluggable embeddings** (no bundled model — closes the runtime half of **P6-6**). Spec/plan: `docs/superpowers/{specs,plans}/2026-06-01-semantic-layer*`.

Plus the May-31-tail items now reflected in the tables above: **P0-3** (WSL-clangd, `b7c15c7`), **P1-6** (`a665e99`), **P3-1/2/4** (`fee3309`), **P4-1** (`0ffb838`), **P5-1/2/4/5** (`18b5bff`). Two adversarial bug-hunt rounds (`9834b46`, `95a4029`) hardened the new work; full suite **1089 pass / 8 skipped / 0 failures** (2026-06-02).

---

## Remaining / deferred 2026-06-01/02 (carry forward — do not lose)

Still-open items from the tables above, plus net-new deferrals from this session:

- **Bundled local embedding model.** `graph_search mode:semantic` is shipped but external/pluggable **on purpose** (`APG_EMBED_ENDPOINT`/Ollama/cloud). A truly BUNDLED local model (zero-config NL search) is the remaining half of **P6-6**.
- **Render `graph_tour` visually in the dashboard.** The tour is verb-first today; surfacing the ordered walk as a guided dashboard overlay is deferred.
- **Agent-eval A/B harness.** A repeatable harness that measures agent value **with vs without** the tool (Read+Grep call counts + wall-clock, n≥2). Explicitly deferred from the front-door work; the `/agent-eval` skill exists but a committed harness/fixtures do not. (`tests/ab/tasks.mjs` is an untracked WIP toward this.)
- **Holistic-review advisories (decide, then act):**
  - **`graph_tour` tier** — promote to the default 15-verb surface vs keep unlisted-but-callable (like `graph_onboard`). Currently full-listed.
  - **Doc-vs-code precedence** — reconcile any remaining notes where docs and code disagree on precedence/behavior.
  - **`/api/overview` cap vs `/api/archetypes` uncapped** — cosmetic mismatch: overview caps cluster count, archetypes does not. Decide one rule and align.
- **Still-TODO from the structured tables (unchanged, not yet done):**
  - **P2** dashboard polish: **P2-2** blast-radius highlight, **P2-5** pathfinder, **P2-6** idle overview panel, **P2-7** async/self-repairing layout, **P2-8** export, **P2-10** sand_castle overlay re-anchor.
  - **P3-3** TS/JS LSP provider (semantic backstop).
  - **P4-3** intent-steering descriptions, **P4-4** `noValueAdded`+telemetry, **P4-5** onboarding tour/hotspots in briefs, **P4-6** neighborhood-walk + near-name suggestions, **P4-7** per-phase progress.
  - **P5-3** hub-as-transit BFS skip. (SSRF kit under P5-1 deferred until a fetch path exists.)
  - **P6-1** circular-dep verb, **P6-2** peripheral→hub anomaly, **P6-3** two-hash manifest, **P6-4** semantic-batching neighborMap, **P6-5** `#include`→header edges verify, **P6-7** self-bundling bootstrap.

---

## Design doctrine (governs HOW to build the above — not a task)
**The "low-salience wall"** (codegraph `CLAUDE.md`, measured): rewording instructions/descriptions barely moves an agent's tool *choice*, and agents under-pick NEW tools. The levers that land: **(a) sufficiency** — make a verb the agent ALREADY calls (`graph_packet`/`graph_pull`) return enough that it stops; **(b) coverage** — make more flows exist statically so existing verbs surface them. Test for every item: "does this make a verb the agent already reaches for do more with the input it already gives?" Validate with A/B (with/without, count Read+Grep calls + wall-clock, n≥2). This is why P1-1 (server-instructions) is real-but-modest ROI, and why enriching `graph_packet` may beat shipping a new `graph_trace`.

---

## Suggested next-round sequence
_All of P0, all of P1, the P2 not-an-island core (P2-1/3/4/9), P3 import-resolution (P3-1/2/4), P4-1/2, and the P5 hardening bundle (P5-1/2/4/5) are now DONE — see the tables + the two 2026-06-01/02 sections above. What's left, in priority order:_
1. **Prove value, then decide surface.** Ship the **agent-eval A/B harness** (deferred from front-door work) — it gates every "did this help?" decision below, including the **`graph_tour` tier** call.
2. **P2 dashboard polish as a unit** — **P2-2** blast-radius highlight (highest action value; pairs with the `graph_explain_diff` overlay JSON) + **P2-6** idle overview panel + **P2-5** pathfinder + **P2-7** async/self-repairing layout + **P2-8** export. Plus render **`graph_tour`** visually here. **P2-10** sand_castle overlay re-anchor is a quick per-repo data fix.
3. **Front-door polish** — **P4-3** intent-steering descriptions + **P4-4** `noValueAdded`/telemetry + **P4-5** onboarding tour/hotspots in briefs + **P4-6** near-name suggestions. Cheap, compounding; heed the low-salience wall.
4. **P3-3 TS/JS LSP provider** (if JS repos matter — the semantic backstop the import waves can't disambiguate).
5. **P5-3** hub-as-transit skip · **P6** insight verbs (cycles/anomaly) + the **bundled local embedding model** · holistic-review advisories (doc-vs-code precedence, `/api/overview` vs `/api/archetypes` cap) — opportunistic.
