# Code-Intel v2 — delivery status, A/B findings, known issues, roadmap

_Living current-state doc. Branch `plan/next-gen-code-intel-bridge`._
_2026-05-08 build round (L0–L5) + 2026-05-31 holistic-review fixes (R1/R2) — both landed. Historical records (master-plan, ab-rubric, ab-results, holistic-review, reference-borrow-synthesis) now live under `docs/code-intel-v2/`._

**Version:** v0.1.0 (major capability milestone — the C++ trust spine, analytics verbs, and shader bridge are all shipped). Listed MCP tool surface is **30** (full profile); long-tail/specialist verbs stay callable-by-name but hidden from `tools/list`.

## Delivered & verified (commits L0–L5)
A cohesive C++-first code-intelligence trust spine for game-dev agents, installed on Hermes + Claude Code, A/B-validated on real sand_castle + echoes.

| Layer | What | Proof |
|---|---|---|
| L0 `9a00e6b` | win32 hygiene (windowsHide, git ls-files -z) | suite green |
| L1 `7cf0b96` | clangd foundation: compile-db discovery + WSL→host normalization + dep filter + doctor | echoes READY 121; sand_castle unity NOT-READY→fix-it |
| L2a `1b72d14` | clangd refs → `LSP_VERIFIED` graph edges (enclosing-caller resolution, invalidation) | real echoes: 12 verified CALLS edges |
| L2b+unity `4ea081b` | `[lsp✓]` marker + TRUST banner (shared helper); unity-build expansion | sand_castle 90 first-party, doctor READY (unity-expanded) |
| L3 `ff51bc9` | await background-index readiness → reliable cross-TU refs; honest lsp-verified vs lsp-partial; method-level callee | ChunkManager::setVoxel 0→3 verified cross-TU callers |
| L4 `2f3c669` | `code_intel_hierarchy` — call + type hierarchy (who-calls-transitively, virtual overrides) | echoes caller tree + ISimDomain→WorldBufferDomain |
| L5 `<this>` | C++↔GLSL shader-binding bridge (`graph_shader`) — the seam no tool crosses | echoes hundreds of GLSL bindings + dozens of C++ load sites; sand_castle dozens of each (run `graph_digest` for live counts) |

Full suite **915 pass / 8 skipped, 0 failures** (2026-05-31). Installed: Claude Code project `.mcp.json` (both games) + Hermes global `config.yaml` (APG_CLANGD set). Both runtimes confirmed reaching the tools by live testers.

## Delivered — round 2 (holistic-review fixes R1/R2 + capability layer) — DONE
The holistic-review (`docs/code-intel-v2/holistic-review.md`) flagged one thesis-critical data-loss bug, ungated absence claims, and cohesion debt. All landed:

- **R1 — correctness / trust (all fixed).** C1 edge data-loss on re-collect (LSP edges no longer mutate the heuristic edge in place; invalidation scoped to synthesizer-created rows); I2 partial/budget-exhausted collects no longer run blanket invalidation; I1 absence claims (`callers`/`callees`/`neighbors`/`impact`) now route empty results through `buildTrustLine` so "NO CALLERS" carries the not-exhaustive caveat + verify hint; I3 per-node `[lsp✓]` gated on `indexReady===true`.
- **R2 — cohesion (made it read as ONE system).** Single `storage/taxonomy.js` registry (NODE_TYPES, RELATIONS + CALL/IMPORT/INHERITANCE/BRIDGE families, EDGE_PROVENANCE_TYPES) — verbs no longer re-declare their own relation slices; `graph_neighbors` now wires OVERRIDDEN_BY/LOADS_SHADER/DECLARES_BINDING/HAS_DIAGNOSTIC; phantom `Struct` filter dropped; unified trust vocabulary on the lsp axis (`lsp-verified/partial/heuristic` headline, edge-count secondary); analytics hybrid output routed through the staleness wrapper; verb surface trimmed to a 30-tool listed front door (planning + analytics + code-intel long-tail hidden-but-callable).

## Agent front door (2026-06-01)
- **Adaptive packet sizing.** `graph_packet` budget + read-first cap are now repo-size-aware (`mcp/stdio/query/response-budget.js` → monotonic tiers keyed on `manifest.nodes`; precedence arg > `APG_PACKET_BUDGET` > tier). Kills god-file truncation on big repos. `graph_explore`/`graph_trace` were already adaptive (`source-bundle.js` line tiers).
- **Front-door tightening.** `server-instructions.js` now names `graph_packet` the explicit FIRST move + an honest KNOWN LIMITS block (dynamic dispatch / script callbacks / cross-lang not synthesized).
- **Staleness banner primitive.** `mcp/stdio/query/staleness-banner.js` — one consistent `⚠ stale: … Read these directly` line for agents to learn once.
- **Freshness self-heal (field-report fix).** `graph_index` is now in the default tool surface; the central staleness warning reports commits-behind + the self-heal hint; opt-in `APG_AUTO_REINDEX=1` makes the dispatch refresh a behind-HEAD graph BEFORE the read handler runs; optional `scripts/install-graph-hook.mjs` installs a post-commit reindex hook (`scripts/reindex.mjs`). Addresses the 2026-06-01 sc-manager Sand Castle A/B: a stale graph was worse than none for managed workers who couldn't reindex. **Overlay-build gap (#3) is a per-repo data action — run `/graph-build-functionality` on the target repo; not tool code.** Spec/plan: `docs/superpowers/{specs,plans}/2026-06-01-graph-freshness-self-heal*`.
- Spec/plan: `docs/superpowers/specs/2026-06-01-agent-front-door-design.md`, `docs/superpowers/plans/2026-06-01-agent-front-door.md`. Suite 1058 pass.

## Semantic layer (2026-06-01)
- **Archetypes.** `mcp/stdio/intelligence/archetypes.js` (game-dev keyword→archetype) names clusters by PURPOSE; wired into `computeOverview` → `graph_overview`/`graph_digest` + a new dashboard **"by archetype"** Map mode (merges communities of the same purpose into ~15 named boxes: Physics/Rendering/Shaders…). Also fixed a latent dashboard bug (community_id is in `extra` JSON, not a column).
- **`graph_tour`.** Ordered N-step orientation (entrypoints → archetype regions → hotspots → cross-subsystem flows); composes the archetype map; `focus` narrows to one subsystem. Full-listed (not default), like `graph_onboard`.
- **Semantic search.** `graph_search(mode:"semantic")` finds code by MEANING via a precomputed embeddings sidecar. **Pluggable, no bundled model**: OpenAI-compatible endpoint via `APG_EMBED_ENDPOINT`/`APG_EMBED_MODEL`/`APG_EMBED_API_KEY` (works with local Ollama or cloud). Build opt-in: `node scripts/build-embeddings.mjs <repo>`. Degrades to lexical + a hint when no sidecar/endpoint. Spec/plan: `docs/superpowers/{specs,plans}/2026-06-01-semantic-layer*`.

## New capability verbs (shipped this round)
- **`code_intel_hierarchy`** — call + type hierarchy (who-calls-transitively, virtual overrides). The trustworthy transitive path for C++; cross-linked from `graph_callers`/`graph_callees`/`graph_impact`/`graph_path`.
- **`graph_trace(from→to)`** — whole call path in one call, hop bodies inlined; smart failure path inlines both endpoints + callers/callees instead of 404.
- **`graph_explore(symbols[])`** — multi-symbol verbatim-source bundler in one budget-capped call ("treat as already Read").
- **`graph_explain_diff(range)`** — reverse of `consequences`: keyed on a git diff/PR → changed components → affected layers → risk.
- **`graph_shader`** — C++↔GLSL shader-binding bridge (`DECLARES_BINDING`/`LOADS_SHADER`).
- **`graph_digest`** — the ONE analytics front door (token-budgeted project digest), composing the now-callable `graph_overview`/`graph_hotspots`/`graph_cycles`.
- **`graph_collect_code_intel`** → imports a clangd collection → `graph_callers`/`graph_pull(layers:["code_intel"])` then render `[lsp✓]` + LSP_VERIFIED on real caller edges.
- **MCP `initialize` server-instructions playbook** (`mcp/stdio/server-instructions.js`) — intent-routed trust-spine guidance injected into the host system prompt once/session; reaches Hermes + Claude identically.
- **Static virtual-override edges** (`OVERRIDDEN_BY`, `provenance:'INFERRED'`) for vtable-heavy engine code.

## A/B findings (real games, both runtimes)
- **Safety spine works (headline).** Refuses unsafe "no callers / safe to delete" claims via the evidence contract (definition_only/degraded/not-exhaustive). Catches fabricated symbols (NOT FOUND, no hallucination). Type-aware disambiguation beats grep's noise on common method names. clangd `references` returned `exhaustive=true` on a real symbol via **Hermes**; managed **Claude Code** reached the tools via MCP.
- **Net-useful for safety + disambiguation**; NOT a strict raw-caller-completeness win over `rg` for uniquely-named symbols in these repos.

## Known issues — status (from live A/B)
1. **Cold `graph_collect_code_intel` MCP stdio drop** (`-32000`) — **ADDRESSED.** Collect is now time-budgeted and returns `partial` + resume rather than blocking the full readiness wait. The live verbs (`code_intel_references`, `code_intel_hierarchy`) remain the unaffected primary path; clangd persists its index (`.aify-graph/code-intel/.cache`) so warm collects are ~1.4s.
2. **Test unity TUs not expanded** — **FIXED.** `compile-db.js` expansion now includes test-target unity TUs (first-party gate includes `tests/`), so test→engine callers surface in `graph_callers`.
3. **Windows clangd sysroot/includes** — **FIXED via opt-in `APG_CLANGD_WSL`.** When a foreign (Linux/WSL-built) compile DB is detected on Windows, set `APG_CLANGD_WSL=1` to run clangd UNDER WSL (`wsl.exe -e clangd`) against the ORIGINAL Linux DB (`build-linux/`, `--compile-commands-dir=/mnt/c/.../build-linux`) — NOT the Windows-normalized copy. File URIs round-trip host↔WSL at the LSP boundary (`hostToWsl`/`wslToHost`, deep-rewritten in `lsp-client.js`), so locations clangd returns come back as Windows paths to the agent/importer. The default (Windows clangd + normalized DB) path is unchanged; WSL mode is strictly additive/opt-in (also `APG_CLANGD_WSL=auto` to auto-engage only on a foreign DB when WSL+clangd are available; default OFF). **Verified on echoes `engine/core/Engine.cpp`:** Windows-clangd baseline = 90 diagnostics dominated by the bogus stdlib cascade (`'string' file not found`, `std::max`/`std::find_if`/`std::ofstream` not found, `rand` undeclared, "too many errors emitted"); WSL-clangd = 15 diagnostics with the stdlib resolving cleanly (only a GENUINE `windows.h` not-found, since the engine is Win32-targeted but compiled with the Linux toolchain — a real diagnostic, not bogus) plus real semantic errors + unused-include hints. Hover returns real types; definitions/references resolve to Windows repo-relative paths (cross-TU verified) with no `/mnt/` leakage. `code_intel doctor` detects WSL availability and prints the exact opt-in when degraded, or READY-for-diagnostics when WSL mode is active. **Unverified/honest caveat:** WSL cold-index of the full game DB (887 background-index commands) is slow — single-file diagnostics/hover/definitions/same-TU refs are fast, but a cold cross-TU `references` query on an arbitrary method can return `not_found_after_retry` until the background index drains (same cold-index behaviour as the Windows path; raise `waitForReadyMs`/re-run warm). The transport, URI round-trip, and stdlib resolution are proven; full-DB cold-index latency is the same caveat the Windows path already carries.
4. **`graph_callers` `[lsp✓]`+TRUST surface parity** — **VERIFIED + locked** (regression-tested; renders whenever LSP caller edges exist).

## Roadmap (live backlog)
**→ The remaining work lives in `docs/code-intel-v2-next-plan.md`.** The P0 correctness fixes, the P1 capability verbs (server-instructions, trace/explore, change-explain), the P2 dashboard analytics-verbs + shader map + overview, and the R1/R2 cohesion fixes are all DONE (marked there). The genuinely-remaining live backlog: **P1-6** (structural-vs-cosmetic change fingerprint), **P3** (JS/TS resolution waves), and the remaining **P4/P5/P6** ergonomics/hardening/research items. (The **P0-3 WSL-clangd diagnostics follow-up** is now DONE — opt-in `APG_CLANGD_WSL`; see known-issue #3.)

Licensing: codegraph+graphify MIT (reused w/ attribution); agent-code-intel UNLICENSED (patterns only).
