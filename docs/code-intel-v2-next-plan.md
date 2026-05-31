# Code-Intel v2 — consolidated NEXT-PLAN backlog (everything not yet done)

_2026-05-08. The single source of truth for remaining work, so nothing from the build round + reference reviews gets lost. Pulls together: not-done layers from the master plan, the original JS-resolution waves we deferred when we pivoted to C++, the 4 A/B known issues, the dashboard research, the "what we missed" sweep, and the agent-UX deep-dive._

DONE so far (for context): L0 win32 hygiene · L1 clangd foundation · L2a clangd→LSP_VERIFIED edges · L2b trust banner + unity expansion · L3 readiness-gated reliable refs · L4 call/type hierarchy · L5 C++↔GLSL shader bridge · installed both runtimes · A/B validated. See `code-intel-v2-status.md`.

Source tags: **[KI]** known-issue/bug · **[MP]** master-plan layer · **[SYN]** original reference-borrow waves · **[DASH]** dashboard research · **[MISS]** "what we missed" sweep · **[UX]** agent-UX deep-dive. License: codegraph/graphify/understand-anything MIT (reimplement w/ attribution); agent-code-intel UNLICENSED (patterns only).

---

## P0 — Correctness / known issues (fix first)

| # | Item | Source | Effort | Notes |
|---|---|---|---|---|
| P0-1 | **Cold `graph_collect_code_intel` drops the MCP stdio connection** (`-32000`) — ~53s cold index exceeds host tool-call timeout. Time-budget the collect (~40–45s), return `partial` + resume token; optionally a separate fast "warm-index" call. | [KI] | M | Live verbs are the unaffected primary path. The marquee collect flow is unusable via MCP until fixed. |
| P0-2 | **Expand TEST unity TUs** in `compile-db.js` (engine unity expands, test ones don't) → test→engine callers currently missing from `graph_callers`. | [KI] | S | Gate first-party to include `tests/`. |
| P0-3 | **Windows clangd sysroot/includes** — WSL/Linux-built `compile_commands.json` has Linux include/sysroot paths absent on Windows → bogus diagnostics/hover; files absent from DB give `compile_entry_missing`. Run clangd under WSL against the Linux DB, OR `--query-driver` + host include discovery, OR strip/translate the Linux sysroot in the normalizer. | [KI] | M | refs/hierarchy stay trustworthy where fresh/exhaustive; this gates diagnostics/hover quality. |
| P0-4 | **`graph_callers` `[lsp✓]` surface parity** — confirm the marker+TRUST line render whenever LSP caller edges exist (verified on `GPU::is_valid`; tester's case had none post-collect due to P0-2). Add a regression test. | [KI] | S | Likely already correct; verify + lock. |
| P0-5 | **C++ virtual-override synthesized `CALLS` edges** (`A::method → B::method` for `class B : A`, capped per class, `provenance:'INFERRED'`). Fills the gap clangd leaves: clangd resolves a `base*->virt()` callsite to the *declared* type's method, not runtime overrides. Game engines are vtable-heavy (ISystem/IRenderer/ISimDomain). | [MISS]#1 | M | codegraph `callback-synthesizer.ts`. **Heed: partial dynamic-dispatch coverage is WORSE than none** — close flows end-to-end. Tag INFERRED, never LSP_VERIFIED. |
| P0-6 | **Hermes installer toolset gotcha** — Hermes CLI profiles filter MCP tools by `platform_toolsets.cli`; a server in `mcp_servers` alone connects but its tools are INVISIBLE in CLI sessions. Add `aify-project-graph` to the toolset list, not just `mcp_servers`. Verify our current Hermes install actually exposes the tools in a CLI profile. | [UX]C7 | S | codegraph `installer/targets/hermes.ts`. Our tester reached tools, but confirm under CLI profiles. |

---

## P1 — High-value capability (biggest agent leverage)

| # | Item | Source | Effort | Notes |
|---|---|---|---|---|
| P1-1 | **MCP `initialize` server-instructions** — a tight intent-routed playbook returned on initialize (every host injects it into the system prompt once/session). Intent table (deletion-safety→code_intel_*; what-breaks→consequences/impact; cross-layer→pull; orient→brief+packet; "trust LSP_VERIFIED, don't re-grep"), common chains, anti-patterns. The one channel that reaches Hermes + Claude identically. | [MISS]#4 / [UX]C1 | S | `server.js:690` currently returns serverInfo only. Canonical home for trust-spine guidance now stuck in skill files Hermes may not load. |
| P1-2 | **`graph_trace(from→to)`** — whole call path in one call, each hop body inlined (`cat -n`), call-site line, dynamic-dispatch bridges annotated; **smart failure path**: when no static path, inline both endpoints' bodies + callers/callees + destination file-mates instead of 404. Path-proximity pairing for duplicate names; MAX_HOPS guard. | [UX]C4 | M/L | codegraph `handleTrace`. High differentiation for C++ dynamic dispatch. Failure-path inlining is borrowable even before edge synthesis. |
| P1-3 | **`graph_explore(symbols[])`** — multi-symbol verbatim-source bundler in ONE budget-capped call, grouped by file, `cat -n` line numbers, repo-size-scaled budget, "treat as already Read" framing. Kills the Read-spiral. | [UX]C3 | M | codegraph `handleExplore` + `getExploreOutputBudget`. |
| P1-4 | **`graph_explain_diff(range)` / change-explain verb** — keyed on a git diff/PR (not a symbol): changed components → 1-hop affected → affected layers → risk score; emit `diff-overlay.json` for the dashboard. Reverse of `consequences` (which is forward-from-symbol). Fills the reviewer/PR-impact gap. | [MISS]#5 / [UX]A1 | M | understand-anything `understand-diff` + agent-code-intel `changed_file_diagnostics`. Reuses our impact/layer/edge machinery. |
| P1-5 | **Generated-file down-ranking** — path-suffix classifier (`.pb.cc/.pb.h`, `moc_*`, `ui_*`, `*_generated.h`, `qrc_*`, `*.gen.h`); generated nodes stay reachable but rank LAST when a hand-written symbol shares the name. Add `generated:true` hint. | [MISS]#2 | S | codegraph `generated-detection.ts`. High hit-rate in game projects (protobuf/Qt/FlatBuffers/reflection codegen). |
| P1-6 | **Structural-vs-cosmetic change fingerprint → tiered rebuild** (SKIP/PARTIAL/FULL). Per-file fp = sigs+members+imports (NOT bodies). Body-only C++ edit → COSMETIC → zero re-resolution. Pairs with the incremental watcher. | [MISS]#3 | M | understand-anything `fingerprint.ts`+`change-classifier.ts`. Turns 30s incrementals into 200ms on big game repos. |

---

## P2 — L6 Dashboard (the layer skipped last round) + make-it-not-an-island

The dashboard is currently a browser-only island that ships up to 25k nodes raw and whose computed analysis (communities/layers/hotspots) no verb returns. Full teardown + plan in the dashboard research (agent `a377c0e6bb01e2c82`).

**Architecture rule:** put aggregation/hotspot/cycle/digest logic in ONE shared `mcp/stdio/intelligence/analytics.js` that BOTH dashboard endpoints AND new MCP verbs call (graphify's pattern) — so viz and agent surface never drift.

| # | Item | Source | Effort | Value |
|---|---|---|---|---|
| P2-1 | **Overview→drill-in with community/layer aggregation** — `/api/overview` returns ~8–30 cluster nodes (by community_id→layer→top-dir) + aggregated inter-cluster edges (width=log count); default 2D view to overview, click to load one cluster. Stop shipping 25k nodes. | [DASH]A1 | M | **Highest** — the only legible front door at 13k files. understand-anything `aggregateLayerEdges`/`deriveContainers`/Louvain. |
| P2-2 | **Blast-radius highlight mode** — `/api/impact/:id?depth=N` (reuse impact/consequences) → `{changed, affected}`; frontend toggle colors changed=red/affected=amber/fade rest. | [DASH]A2 | M | Highest *action* value. understand-anything `DiffToggle`. Pairs with P1-4 overlay JSON. |
| P2-3 | **Shader-binding sub-view** — edge-relation filter group for `DECLARES_BINDING`/`LOADS_SHADER`; "Shader map" preset showing ShaderBinding nodes + CPU declarers/loaders; distinct color + legend + node shape. | [DASH]A3 | S | Bespoke game value; edges already exist. |
| P2-4 | **Provenance ribbon upgrade** — code edges solid (LSP_VERIFIED) vs dashed (heuristic); `lsp-verified` pill; top-line "X% of call edges LSP-verified." | [DASH]A4 | S | Trust signal unique to C++ noisy call graphs. |
| P2-5 | **Pathfinder** — `/api/path?from=&to=` bidirectional BFS, clickable numbered chain. | [DASH]A5 | M | understand-anything `PathFinderModal`. |
| P2-6 | **Idle Project-Overview panel** — replace "click a node" with stats + top-10 god nodes + type/community distribution bars. | [DASH]A6 | S | understand-anything `ProjectOverview` + graphify `god_nodes`. |
| P2-7 | **Async + self-repairing layout** — move positioning off-thread (worker); orphan-edge/missing-dim repair pass + banner; consider elkjs for the (small) drilled-in cluster view. | [DASH]B1 | M | understand-anything `repairElkInput`. |
| P2-8 | **Export** — PNG/SVG + filtered-graph JSON (re-loadable). + keyboard shortcuts; richer in-node encoding; cycle list. | [DASH]B2/B3/C1/C2 | S each | JSON export is the useful half. |
| P2-9 | **Expose analytics as VERBS + a digest** (ends the island): `graph_overview` (cluster map), `graph_hotspots` (god nodes), `graph_communities`/`graph_layers`, `graph_cycles`, and a `graph_digest` / `/api/digest` token-budgeted text summary (layers, hotspots, shader-binding counts, provenance %, tightest cycles, community bridges). | [DASH]§4 | M | graphify `serve.py` resources + `_subgraph_to_text`. One verb gives an agent the dashboard's whole analytic value in ~1–2k tokens. |
| P2-10 | **Overlay repair** — sand_castle `functionality.json` anchors broken (0/9) → `graph_packet` degraded there. Re-anchor / regenerate. | [MP] | S | |

---

## P3 — JS/TS resolution (original waves we deferred when pivoting to C++)

Still real: the JS graph has **~1476 fixable + 87 IMPORTS** unresolved edges (`unresolved-categorization.js` scoreboard). We did W1/W2 (=L0) and W6 (install) but NOT these:

| # | Item | Source | Effort | Notes |
|---|---|---|---|---|
| P3-1 | **IMPORTS: extension-probe + tsconfig path-aliases + `require()` pass** in `normalizeImportSource`/resolver. Fixes the 87 IMPORTS. Additive (can't regress). | [SYN]W3 | S→M | understand-anything `extract-import-map.mjs` (posix.normalize leading-`./` strip is load-bearing). |
| P3-2 | **CALLS/REFERENCES import-evidence resolution** — per-file import map into `resolveTarget`; unique-match-only (INFERRED), receiver-type inference. Fixes bulk of the 1476. Measure against `fixable:*` scoreboard. | [SYN]W4 | M | codegraph `name-matcher` + graphify Tier-A. False-positive risk → guard. |
| P3-3 | **TS/JS LSP provider** (`ts-tsserver.js` mirroring cpp-clangd) — semantic backstop for JS CALLS name-matching can't disambiguate. The clangd spine generalizes to it. | [SYN]W5 | M | typescript-language-server `--stdio`; reuse importer + resolveServer chain. |
| P3-4 | **`packet.js` skeletonize-before-drop** — compress dir-prefix-shared list items + keep header+count before dropping tail sections; never drop the `target` section. | [SYN]W7 | S→M | codegraph adaptive sizing. |

---

## P4 — Ergonomics / polish (cheap, compounding)

| # | Item | Source | Effort |
|---|---|---|---|
| P4-1 | **Repo-size / profile-adaptive tool gating** — hide low-value verbs on small/lean repos (5-tool empirical floor); `APG_MCP_TOOLS` env allowlist for A/B ablation (truly absent from ListTools). | [UX]C5 | S |
| P4-2 | **Soft per-file staleness banner** (vs our current hard blocker) — flag only the stale files referenced in *this* response ("Read these directly; rest is fresh"); cost = one boolean when nothing pending. | [UX]C6 | S |
| P4-3 | **Intent-steering tool descriptions** — designate ONE primary verb ("call FIRST"); each description names the better alternative for adjacent intents; "returned source is Read-equivalent — don't re-open." | [UX]C8 / [MISS]#7 | S |
| P4-4 | **`noValueAdded` flag + per-response telemetry block** — `{noValueAdded:true}` when freshness≠fresh AND empty (distinguishes "verified-none" from "not-ready"); `telemetry{latencyMs, freshness, callCounts}`. | [MISS]#6 | S |
| P4-5 | **Onboarding upgrades** — ordered guided **tour** (entry-point-first numbered path) + **complexity-hotspots** "approach carefully" section in briefs/`graph_onboard`. | [UX]A3 | S/M |
| P4-6 | **`graph_explain` neighborhood-walk mode** + **no-match→suggest graph-derived near-names** across all symbol-keyed verbs. | [UX]A4/A5 | S |
| P4-7 | **Per-phase progress reporting** (`[Phase N/7]…`) in long-running build skills. | [UX]A6 | S |

---

## P5 — Hardening / hygiene

| # | Item | Source | Effort |
|---|---|---|---|
| P5-1 | **Pre-parse JSON size cap** on `.aify-graph/*.json` before `JSON.parse` (memory-bomb guard) + recursive bounded metadata sanitizer; SSRF kit (scheme allowlist, private/metadata-IP block, DNS-rebinding + redirect re-validation) for any future fetch path. | [MISS]#8 | S |
| P5-2 | **Cross-language-family phantom-edge drop** — drop inferred CALLS/REFERENCES whose endpoints are different language families, except through known bridges (our shader binding). Precision guard. | [MISS]#10 | S |
| P5-3 | **Hub-as-transit BFS skip** in path/trace — don't expand *through* high-degree hubs (`max(50,p99)`); they can be endpoints, not waypoints (avoids `A→Logger→B` noise). | [MISS]#11 | S |
| P5-4 | **clangd child process hygiene** — PPID-poll self-exit when parent dies (orphaned clangd keeps watches/WAL alive); watcher excludes ignored dirs BEFORE registering (inotify budget ceiling on big repos). | [MISS] meta | S |
| P5-5 | **Worktree redirect** (stronger than a notice) — if run inside an ephemeral worktree, redirect `.aify-graph` output to the main repo root (`--git-dir` vs `--git-common-dir`) so the graph isn't destroyed on session end. | [UX]A6 / [SYN]secondary | S |

---

## P6 — New analysis insights / deferred research

| # | Item | Source | Effort | Verdict |
|---|---|---|---|---|
| P6-1 | **Circular-dependency detection verb** (file-level, bounded `simple_cycles`, rotation-dedup, tightest-first). | [SYN]secondary / graphify | S→M | Worth it (C++ header tangles). |
| P6-2 | **Peripheral→hub anomaly detector** — flags a low-degree node unexpectedly reaching a hub (layering-violation smell). | [MISS]#9 | S→M | New insight verb. |
| P6-3 | **Two-hash manifest** (AST vs semantic) — re-run LLM intelligence only on content-changed files. (Partly addressed by L3 readiness, NOT the manifest split.) | [SYN]secondary | S→M | Cost/perf. |
| P6-4 | **Semantic-batching neighborMap feeding** for the intelligence layer (import-neighbors + their exported symbols into each summary call); port the neighborMap even without Louvain. Info-vs-Warning discipline. | [UX]A2 | S (neighborMap) / L (Louvain) | Quality win for summaries. |
| P6-5 | **`#include`→header file-edges + typed-member-pointer caller resolution** — verify our clangd path yields these; the `m_alg->Process()` typed-member case is the subtle C++ one. | [MISS]#13 | S to verify | |
| P6-6 | **Embedding / NL semantic search** (cosine over per-node embeddings, type filter). | [MISS]#12 / [UX] | L | Defer (needs embedding source). |
| P6-7 | **Self-bundling bootstrap** (atomic staged dep install) for "just works" plugin install both runtimes. | [SYN]secondary | M/L | |

---

## Design doctrine (governs HOW to build the above — not a task)
**The "low-salience wall"** (codegraph `CLAUDE.md`, measured): rewording instructions/descriptions barely moves an agent's tool *choice*, and agents under-pick NEW tools. The levers that land: **(a) sufficiency** — make a verb the agent ALREADY calls (`graph_packet`/`graph_pull`) return enough that it stops; **(b) coverage** — make more flows exist statically so existing verbs surface them. Test for every item: "does this make a verb the agent already reaches for do more with the input it already gives?" Validate with A/B (with/without, count Read+Grep calls + wall-clock, n≥2). This is why P1-1 (server-instructions) is real-but-modest ROI, and why enriching `graph_packet` may beat shipping a new `graph_trace`.

---

## Suggested next-round sequence
1. **P0** (correctness) — P0-1 collect-connection + P0-2 test-unity + P0-5 virtual-override edges + P0-6 Hermes toolset (these directly fix what the A/B exposed).
2. **P1-1 server-instructions** (S, the cheapest high-leverage steer) + **P1-5 generated down-ranking** (S) + **P1-4 change-explain verb** (M).
3. **P2 dashboard** as a coherent unit (P2-1/2/9 first — overview, blast-radius, analytics-verbs+digest — the not-an-island fixes), shader map + provenance ribbon, then polish.
4. **P1-2 trace / P1-3 explore** (heed low-salience-wall — pair with enriching packet).
5. **P3 JS resolution** (if JS repos matter) · **P4/P5/P6** opportunistic.
