# APG Code-Intel v2 — Master Plan (the C++ trust spine)

_2026-05-08. Autonomous build mandate: holistic, cohesive C++-first code-intelligence for game-dev agents (sand_castle + echoes_of_the_fallen), running on Hermes + Claude Code. Investigation evidence: `docs/code-intel-v2/reference-borrow-synthesis.md` + 5 deep-recon agents (see memory `reference-borrow-plan`)._

## North star
One coherent product: **trustworthy C++ answers, evidence-gated, surfaced through a unified query layer, backed by clangd-when-it-matters + static-always, visible in a provenance-aware dashboard.** Not a patchwork of borrowed tricks — one spine everything hangs off.

## Ground truth from recon (decisions rest on these)
- First-party code is small (~135 / ~1,225 files); `_deps/`+`build*/` dominate file counts and must be hard-excluded. clangd is viable.
- compile_commands blockers: sand_castle = **unity builds** (DB points at `Unity/unity_*.cxx` aggregates) + WSL paths; echoes = **VS generator emits no DB**, only `build-linux/compile_commands.json` exists. Tool must discover/repair these.
- Both games barely use templates/virtuals at source level EXCEPT echoes' `ISimDomain` pure-virtual dispatch + Vulkan/volk function-pointer dispatch + string-keyed console-command dispatch — exactly what static graphs undercount and clangd resolves.
- Dominant documented pain: **symbol hallucination in reviews**, **"fixed A, missed B"**, **unsafe deletion** → all answered by an **exhaustive-caller evidence contract**. Second: **C++↔GLSL binding contract** (no tool crosses it).
- Review model in both repos is **contract-cited + test-proven**, but `.aify-graph` overlays have empty docs/tests links.
- Current stack: `--background-index=false` (cross-TU unreliable); collect→graph writes side tables only (`importV02Collection` never calls upsertNode/upsertEdge) → graph verbs blind to clangd; 10s hardcoded timeout; 200-file cap; no call/type hierarchy; includes orphaned; virtual/macro context never set.

## Unified architecture (target)
```
RUNTIME SHIMS:  MCP(server.js) · CLI(apg) · [Hermes & Claude Code both launch the Node server over stdio]
QUERY/RENDER:   ~12 intent verbs, 3 families, ONE output contract + TRUST BANNER on every answer
GRAPH CORE:     nodes/edges tagged provenance = extracted | heuristic | lsp-verified
PROVIDERS:      static(tree-sitter, always) + LSP(clangd, truth)  — SHARE compile_commands discovery
ANALYSIS/DASH:  god-nodes · communities · cycles · blast-radius · shader-binding map · provenance ribbon
INCREMENTAL:    two-hash (structural ast_hash + verified lsp_hash) · windowsHide · git ls-files -z
```

## Revisions from Hermes tech-lead adversarial review (2026-05-08)
- **Reframed success**: the win is *"refuses absence claims unless proven exhaustive."* Degraded/cold evidence is a **first-class successful refusal**, not a failed feature. Do NOT target "always exhaustive:true."
- **clangd mode matrix** (explicit product decision, not just a toggle):
  - `INDEXED` (default for collect + games): `--background-index` ON; can claim `exhaustive:true` ONLY after a readiness proof (background-index done via `$/progress`) + definition cross-check. Cost: slower cold start, on-disk index, cache churn.
  - `BOUNDED` (fast inner-loop / opt-in via `APG_CLANGD_MODE=bounded`): background-index off; **never** claims exhaustive; good for "does X exist / quick refs in open files."
- **Provenance is load-bearing**: edges carry `provenance ∈ {EXTRACTED (tree-sitter exact), INFERRED (heuristic), LSP_VERIFIED (clangd)}`. `LSP_VERIFIED` is **never rendered equal** to heuristic. LSP edges tagged with `compile_db_hash` (index generation); on hash change, prior `LSP_VERIFIED` edges for the repo are **invalidated** so stale clangd edges can't linger.
- **Sequencing**: P0 trust spine = L1(done)+L2+L3 proven on echoes w/ regression fixtures → P1 hierarchy (L4) → P2 shader bridge (L5) + dashboard/cohesion (L6). Depth verbs and GLSL bridge must NOT precede a stable evidence contract.
- **Unity honesty**: echoes = proving ground (doctor READY, 121 first-party). sand_castle = unity → doctor returns NOT READY + reconfigure fix-it; ship fixtures for BOTH the READY and unity-blocked states; do not claim sand_castle exhaustive support before a non-unity DB exists.
- **A/B rubrics** (L7): adversarial tasks w/ pass-fail — dead-code deletion refusal, virtual-dispatch caller list, shader-binding mismatch, wrong-symbol review. "No unsafe absence claim" outranks speed.

## Build sequence (coherent layers, each shippable + tested)

### L0 — Foundation hygiene (certain, zero-risk) ✅ do first
- `windowsHide:true` on all ~18 child_process sites (shared helper `mcp/stdio/util/exec.js`).
- `git ls-files -z` in git-candidates (non-ASCII paths).
- Outcome: no win32 console flashes; correct enumeration. Tests.

### L1 — clangd foundation that actually runs on the games (P0)
- `compile_commands` discovery upgrade (`code-intel/compile-db.js`): probe `build/`, `build-linux*/`, `build-debug*/`, `out/`, `cmake-build-*`; pick the richest; **detect unity builds** (entries → `Unity/unity_*.cxx`) and emit an actionable `unity_build` diagnostic (suggest `-DUNITY=OFF` reconfigure or expand); **normalize WSL `/mnt/c/...`↔Windows `C:/...`**; exclude `_deps/`,`build*/`,`thirdparty/`.
- clangd spawn upgrade (`providers/cpp-clangd.js`, `live.js`): `--background-index=true` (+ `--background-index-priority=normal`), `-j`, `--pch-storage=memory`, `--compile-commands-dir`, `--query-driver` for the games' compilers; parameterize timeout (cold up to ~60s), wire provider `maxRequestMs` into the client.
- `code_intel doctor` → agent-readable readiness: clangd on PATH? compile_commands found/usable? unity? indexing state? Returns fix-it guidance.
- Outcome: references/definitions become trustworthy cross-TU on both games.

### L2 — Connect clangd → graph (the central cohesion fix, P0)
- `importV02Collection` (or a new path) calls `upsertNode`/`upsertEdgeLike` so clangd references/definitions/calls become **graph edges with provenance `lsp-verified`** (not just side-table rows).
- `graph_callers`/`graph_callees`/`graph_impact`/`graph_neighbors` read these and **prefer lsp-verified over heuristic**, carrying provenance through render.
- Outcome: one graph, two providers; the disconnected engines become one.

### L3 — Evidence/exhaustiveness trust spine (the killer feature)
- Reimplement (patterns only — ACI is UNLICENSED) the `evidence{ready,degraded,cause,confidence,exhaustive}` + warnings contract, computed from freshness gate → definition cross-check → "definition-only/empty ≠ no callers" rule.
- Surface on `graph_callers`/`graph_impact`/`code_intel_references` and in `graph_packet` (verify/review modes). Absence claims ("no callers","safe to delete") gated on `exhaustive===true`.
- Outcome: directly kills symbol-hallucination + unsafe-deletion pain.

### L4 — C++ depth verbs (clangd)
- Call hierarchy (`prepareCallHierarchy`/incoming/outgoing) and type/override hierarchy (`typeHierarchy/subtypes`) → resolves echoes' `ISimDomain` virtual dispatch + Vulkan fn-pointer hubs. Surface as `graph_hierarchy` and fold virtual-override resolution into callers.
- workspace/symbol search → fixes the LIKE-vs-FTS5 split-brain; one good `graph_search`.

### L5 — C++↔GLSL shader-binding bridge (unique, both games)
- Static analyzer (`ingest/frameworks/shader_bindings.js`): parse GLSL `layout(set=,binding=N) ... Buf` decls + C++ shader-by-name loads + `vkUpdateDescriptorSets`/descriptor-write call sites; emit cross-layer edges (`BINDS_SHADER`, `DESCRIBES_BINDING`). Surface via a `graph_shader` verb + dashboard map.
- Outcome: the seam no tool crosses — high differentiation.

### L6 — Cohesion + overlays + dashboard
- Collapse overlapping verbs into a clear primary (`graph_packet`/`context`) + thin specializations; consistent output contract + trust banner everywhere; auto-escalate graph→clangd for C++ precision.
- Expose hotspots/communities/architecture as verbs (not dashboard-only). Source↔contract↔test linking into overlays (both games' review model needs it).
- Dashboard: provenance ribbon, blast-radius overlay, god-nodes, cycles, shader-binding map.

### L7 — Install both runtimes + A/B test
- MCP config + plugin install for Hermes and Claude Code; verify tools register/run on both.
- Spawn `sc-graph-tester-1` (hermes) + `sc-graph-tester-2` (claude code) in sand_castle; real planning/debugging tasks; A/B vs no-tool; collect usefulness evidence. Optionally more agents for statistical A/B.

## Scoreboard / acceptance
- clangd references on a known game symbol returns `exhaustive:true` with real cross-TU callers (today: impossible).
- `graph_callers` on a C++ symbol shows lsp-verified edges (today: tree-sitter only, blind to clangd).
- Unresolved-edge fixable bucket trends down after collect (today fixable=1476 @ js; track cpp separately).
- A/B: testers complete a real sand_castle task faster / with fewer wrong-symbol assertions using the tool vs without.

## Licensing
codegraph+graphify = MIT (reuse w/ attribution, keep ATTRIBUTION.md); agent-code-intel = UNLICENSED → patterns only, reimplement.
