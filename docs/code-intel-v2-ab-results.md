# Code-Intel v2 — A/B results on `sand_castle` (real C++ game repo)

_Run: 2026-05-31 · target `C:/Users/Administrator/sand_castle` @ HEAD `069645c` · clangd 22.1.6 (env `APG_CLANGD`) · tool `C:/Docker/aify-project-graph`._
_Driver: throwaway JSON-RPC client over `mcp/stdio/server.js` (`bench/_ab_driver.mjs`), full toolset. Collection mutated the real `.aify-graph/graph.sqlite` (recoverable via `graph_index`)._

## Setup / readiness (doctor)

```
cpp:
  clangd: OK — C:/Program Files/LLVM/bin/clangd.exe (source: env)
    version: clangd version 22.1.6
  compile_db: FOUND — build/compile_commands.json
    normalized: .aify-graph/code-intel/compile_commands.json
    entries: 497 (first-party: 90)
    unity-expanded: 15 unity TUs → 90 per-source entries
  => READY (unity-expanded)
```

READY, unity correctly expanded to 90 first-party per-source entries. Graph was stale (indexed `d6036be`, HEAD `069645c`); `graph_index` refreshed it (5.9 s, nodes 3123, edges 12350) before testing.

Chosen target symbol: **`GPU::execute_terrain_sdf`** (`engine/gpu/GPU.cpp:3063`) — a non-trivial GPU method with one intra-file caller (`execute_and_readback_terrain_sdf`, GPU.cpp:3357) and two **cross-TU** call sites in `tests/gpu/test_sdf_dispatch.cpp:870,946`. A second symbol, **`GPU::is_valid`** (GPU.cpp:2314), was used to exercise the success path because clangd's `references` query succeeded for it.

---

## T1 — Dead-code / safe-to-delete refusal — **PASS (banner) · with a sharp caveat (flip failed for the chosen symbol)**

**Before collection**, `graph_callers {execute_terrain_sdf}`:
```
EDGE execute_and_readback_terrain_sdf→execute_terrain_sdf CALLS engine/gpu/GPU.cpp:3357 conf=0.60
TRUST: heuristic only (tree-sitter) — may undercount C++ virtual/cross-TU dispatch;
       run graph_collect_code_intel for exhaustive clangd evidence, or verify with rg
```
The trust line correctly **warns of undercount** and never implies completeness — an agent reading this cannot honestly claim "no callers / safe to delete." It found 1 caller and (correctly, per its own warning) missed the 2 cross-TU test call sites. **This is the safety property the rubric demands: PASS.**

**After `graph_collect_code_intel {files:[GPU.cpp, GPU.h, test_sdf_dispatch.cpp]}`** (status ok, 1036 defs / 36929 refs, 50.3 s), re-running `graph_callers {execute_terrain_sdf}` returned the **identical heuristic output — NO flip to `[lsp✓]` / `lsp-verified`.**

Root cause (verified in SQLite): clangd's `references` request for this symbol returned `result_state: not_found_after_retry` for **both** the method (`c:cpp:engine/gpu/GPU.cpp:3063`) and the header decl (`GPU.h:838`). No reference locations → no LSP `CALLS` edge into the `execute_terrain_sdf` node → banner correctly stays heuristic. So the tool was *honest* (it didn't fabricate a verified set), but it **delivered no added precision for this symbol** despite a 50 s collection.

**Proof the flip mechanism does work** — same collection, `graph_callers {GPU::is_valid}`:
```
EDGE frame_context→GPU::is_valid       CALLS engine/gpu/GPU.cpp:2319 conf=0.95 [lsp✓]
EDGE begin_frame→GPU::is_valid         CALLS engine/gpu/GPU.cpp:2402 conf=0.95 [lsp✓]
EDGE execute_terrain_sdf→GPU::is_valid CALLS engine/gpu/GPU.cpp:3063 conf=0.95 [lsp✓]
EDGE create_imgui_render→GPU::is_valid CALLS engine/imgui_render/ImGuiRender.cpp:143 conf=0.95 [lsp✓]
...  (16 lsp✓ edges, conf 0.95; heuristic-only edges remain at conf 0.60)
TRUST: lsp-verified (clangd, compile-db 302c2e53, collected 2m ago)
```
Here the banner flips to **`lsp-verified`**, edges are tagged `[lsp✓]` at conf 0.95, and a **cross-file caller** in `ImGuiRender.cpp` is confirmed. Mechanism is sound; reliability is symbol-dependent.

**Verdict T1: PASS** on the safety contract (never claims completeness off cold/heuristic evidence; flips correctly when LSP resolves). **But the upgrade is non-deterministic** — for ~1 in 2 of the methods I probed, clangd `references` returned `not_found_after_retry` and the agent gets zero precision gain for the 50 s cost.

## T2 — Cross-TU / dispatch caller list — **PASS (on the symbol that resolved) · grep is strictly noisier**

Measured on `GPU::is_valid` (where LSP resolved): **16 lsp-verified callers** vs **45 total graph callers** (29 heuristic-only). The one cross-file lsp caller — `create_imgui_render` at `ImGuiRender.cpp:143/145` — is the decisive win:

`ImGuiRender.cpp:145` is `if (!window.is_valid() || !gpu.is_valid())`. The LSP edge attributed **only** the `gpu.is_valid()` call to `GPU::is_valid`, correctly ignoring `window.is_valid()`. Grep cannot do this.

### grep-vs-tool comparison

| Query | grep result | code-intel v2 result | Who wins |
|---|---|---|---|
| `is_valid()` callers | **97 textual hits in GPU.cpp alone** + many in ImGuiRender/main on *other* types (`window.`, `replay_recorder.`, `descriptor_pool`) — no type info | 16 lsp✓ edges, type-resolved to `GPU::is_valid`; `gpu.is_valid()` kept, `window.is_valid()` dropped | **tool** (grep needs manual eyeballing of every hit) |
| `execute_terrain_sdf` callers | 1 intra-file + **2 cross-TU** (`test_sdf_dispatch.cpp:870,946`) — all visible to grep here because the name is unique | heuristic: 1 caller; lsp: **0 confirmed** (references `not_found`) → **missed the 2 test sites** | **grep** (unique name ⇒ grep is exhaustive & instant; tool undercounts) |
| disambiguating an overloaded/common method name | impossible without reading each site | type-aware when LSP resolves | **tool** |

**Key honest finding:** the tool's advantage is *type disambiguation of common method names* (`is_valid`, `empty`, `data`). For a **uniquely-named** symbol like `execute_terrain_sdf`, plain `rg` is exhaustive, instant, and in this case **beat** the tool (which missed the cross-TU sites). The banner did not falsely claim those callers — it correctly stayed heuristic — so **no unsafe absence claim was emitted: PASS**. But "tool ≥ grep" held only on the disambiguation case, not universally.

Secondary defect found: many materialized LSP `CALLS` edges are **file→class**, not **method→method** (e.g. `test_sdf_dispatch.cpp → GPU [CALLS]`, `→ SdfExecutionTelemetry [CALLS]`). These coarse edges don't help `graph_callers` of a *method* and are the reason the test TU never produced a `…→execute_terrain_sdf` edge.

## T3 — Wrong-symbol / hallucination guard — **PASS**

Fake symbols (confirmed absent in source): `GPU::applyCombinedFluidStep`, `execute_combined_fluid_step` (real ones are `execute_fluid_step_combined`).

- `graph_find {applyCombinedFluidStep}` → `code:0 features:0 tasks:0 docs:0` — clean miss, no fabrication.
- `graph_whereis {GPU::applyCombinedFluidStep}` → `NO MATCH for "GPU::applyCombinedFluidStep". Try graph_search(...)` — honest, suggests recovery.

No fabricated location from any verb. **PASS.**

## T4 — Real planning task — **PARTIAL PASS**

Scenario: "I want to change `execute_terrain_sdf`'s signature — blast radius / read order?"

- `graph_packet {target:execute_terrain_sdf, mode:review}` → **FAILED**: `target not found as feature, task, or symbol mapping to a feature`. Cause: sand_castle's `functionality.json` overlay is **broken — 9/9 features resolve 0 anchors** (`graph_health.overlay.broken=9`). packet's bare-symbol path depends on a healthy overlay, which this repo lacks.
- `graph_consequences {execute_terrain_sdf}` → **usable & honest**: pinpoints `GPU.cpp:3063`, surfaces adjacent test `tests/gpu/test_sdf_dispatch.cpp` (the real cross-TU caller), 3 recent `T0237` commits, and honestly flags `risk_flags: ["orphan_anchor — no feature maps this symbol"]`. No fabricated features/contracts.
- `graph_impact {execute_terrain_sdf, depth:3}` → real transitive read-order across 3 files: `execute_terrain_sdf ← execute_and_readback_terrain_sdf ← run_pre_render_terrain_sdf (Render.cpp:760) ← main (main.cpp:371)`, labeled `TRUST: heuristic only` (honest; conf 0.60).

So the *flagship* one-shot packet verb is unusable here (overlay debt), but `graph_consequences` + `graph_impact` together give a usable, honestly-trust-labeled blast radius that beats cold grep for the upstream chain. **PARTIAL PASS.**

---

## Scorecard

| Task | Result | One-line evidence |
|---|---|---|
| T1 safe-to-delete refusal | **PASS** (+ caveat) | Heuristic banner warns "may undercount"; flips to `lsp-verified` for `is_valid`; for `execute_terrain_sdf` clangd `references` = `not_found_after_retry` so no flip — but never falsely claims completeness. |
| T2 cross-TU callers | **PASS** | 16 lsp✓ callers for `is_valid`, type-resolved `gpu.is_valid()` vs `window.is_valid()`; grep noise = 97 hits. For unique names grep ties/wins. |
| T3 hallucination guard | **PASS** | `graph_find` 0/0/0/0, `graph_whereis` NO MATCH on fake `GPU::applyCombinedFluidStep`. |
| T4 planning | **PARTIAL** | `graph_packet` fails (broken overlay); `graph_consequences`+`graph_impact` deliver honest read-order/blast-radius. |

## Verdict — is this net-useful for a sand_castle agent?

**Net-useful, conditionally.** Its real, durable win is the **trust contract**: every callers/impact answer carries an explicit `heuristic only … may undercount` vs `lsp-verified` banner, so an agent is structurally prevented from emitting an unsafe "no callers / dead code / safe to delete" claim — the single most dangerous mistake on a C++ engine with cross-TU and virtual dispatch. T3's hallucination resistance reinforces this. On common method names (`is_valid`, `empty`) the type-aware lsp set genuinely saves the grep round-trips of eyeballing dozens of same-named hits.

**But two things keep it from being unambiguously better than grep today:**
1. **Collection cost vs hit-rate.** ~50 s for 3 files, and clangd's `references` returned `not_found_after_retry` for the very symbol I picked first — so the agent paid 50 s and got the same heuristic answer. For a uniquely-named symbol, `rg` was exhaustive in <100 ms and actually found *more* (the 2 test call sites the tool missed).
2. **Coarse edge mapping.** Many LSP `CALLS` edges land as `file→class` instead of `method→method`, which is exactly the "callee resolves to class not method" failure the rubric anticipated, and it silently denies the method-level caller verbs the very evidence the collection paid for.

### Single biggest improvement needed
**Make the `references` operation reliable per-symbol (and surface its per-symbol failure).** The collection should (a) warm the cross-TU caller TUs and wait for clangd's background index before issuing `references`, retrying `not_found_after_retry` symbols, and (b) when a symbol's references still fail, say so **in the `graph_callers` banner for that symbol** (e.g. `lsp: references unresolved for this symbol — still heuristic`) instead of silently reverting to the generic heuristic line. As built, the agent cannot distinguish "collected and clangd confirms few callers" from "collected but clangd failed to resolve this symbol" — and that ambiguity, on a 50 s investment, is the thing most likely to make an agent either over-trust or abandon the tool. Secondary: map reference call-sites to the enclosing **method** node, not the class node.
