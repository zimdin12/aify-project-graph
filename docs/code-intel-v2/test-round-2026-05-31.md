# Code-Intel v2 — controlled full-toolset test round (2026-05-31)

**Tester:** graph-tester agent (autonomous). **Driver:** newline-delimited JSON-RPC against `node mcp/stdio/server.js` (`tmp-driver.mjs`), `APG_CLANGD=C:/Program Files/LLVM/bin/clangd.exe`.
**Repos:** echoes (`C:/Users/Administrator/echoes_of_the_fallen`, clangd-ready, ~121 first-party) primary; sand_castle (`C:/Users/Administrator/sand_castle`, unity-expanded ~90) spot-check.
**Mutations:** ran `graph_collect_code_intel` into BOTH real graphs (recoverable via `graph_index`). Game SOURCE untouched (read-only). Wrote only this doc + `.aify-graph` collections.

> **Driver note (not a tool bug):** the server speaks **newline-delimited JSON**, not LSP `Content-Length` framing. A first driver assuming Content-Length hung. Worth documenting for future testers.

---

## Verdict up front

**Not yet "really good" — one HIGH-severity trust bug undermines the toolset's entire thesis.** The positive paths (orientation, source bundling, type hierarchy, shader bridge, diff explain, and the `[lsp✓]` caller-rendering when LSP edges exist) are genuinely strong and well-built. But the **absence/"no callers" path mislabels incomplete clangd results as `lsp-verified-exhaustive — TRUSTWORTHY absence`**, reproducibly, on both repos, on textbook "is it safe to delete" symbols that demonstrably DO have callers. That is precisely the claim the trust spine exists to make safe, so the bug is disqualifying until fixed. The trust **vocabulary is also not unified** (R2b regressed): the same symbol's empty caller set is reported as "exhaustive/trustworthy" (`graph_callers`), "exhaustive:true high-confidence" (`code_intel_hierarchy`), "heuristic only" (`graph_change_plan`), and "exhaustive:false / absence unsafe" (`code_intel_references`) — four verbs, four verdicts.

---

## Per-tool results

### 1. initialize — PASS
`instructions` server-playbook returned. Mentions `[lsp✓]` (provenance LSP_VERIFIED), the `TRUST: lsp-verified (index-ready, N callers)` exhaustive-banner rule, lsp-partial/heuristic caveats, and evidence-gated absence ("safe to delete ONLY when exhaustive"). Trust rules present and correct.
*Rough edge (Low):* the playbook says `graph_packet {target} — one packet of everything about a feature/**symbol**`, but `graph_packet` rejects bare symbols (see #3).

### 2. graph_health + graph_digest — PASS (very useful)
`graph_health` (JSON): good `summary` one-liner; nodes/edges/trust/dirty/overlay-quality/codeIntel. On echoes it reported `codeIntel.available:false reason:no_collection` (no persisted LSP collection had been run for echoes — orientation gap, not a bug; sand_castle had one with 12 487 refs).
`graph_digest` (markdown, **~450 tokens** — well within 1-2k budget): clusters, hotspots (with in/out degree), shader bindings, provenance %, OVERRIDDEN_BY count, cycles, community bridges. **Genuinely useful single-shot orientation.**
*Rough edges:*
- *(Doc-staleness, Low)* digest shows echoes **988 bindings / 308 loads**; status doc claims "212/86". sand_castle **28/22** vs doc "28/40". The status doc's shader numbers are stale.
- *(Medium)* echoes hotspots and shader-loaders include `tools/probe_*.py` and `.claude/worktrees/agent-*/...` copies as if first-party — worktree/scratch pollution inflates the graph (see #8).

### 3. graph_packet — PASS (with caveat)
`{target:"pcas-simulation", mode:review}` → clean READ FIRST / CONTRACTS / TESTS / RISKS / NEXT, honest `EVIDENCE: tree-sitter+overlay only; code_intel unavailable`. Usable read-order.
*Rough edge (Medium):* bare symbol targets are rejected — `{target:"WorldBufferDomain"}` →
`ERROR: target "WorldBufferDomain" not found as feature, task, or symbol mapping to a feature`.
Contradicts the initialize playbook which advertises symbol targets. Either the verb or the playbook is wrong.

### 4. graph_collect_code_intel + graph_callers — MIXED (HIGH-severity bug)
**Collect:** completed warm on echoes (`indexReady:true`, 4 files, 6.9s, 312 refs / 185 defs / 69 diags, no budget exhaustion). Resume/partial machinery present.
*Rough edge (Low/Med):* `language` is **required with no default**, while every other `code_intel_*` verb defaults `language:'cpp'`. Omitting it returns a terse `{"code":"language_unsupported","message":"language required"}`. Inconsistent and easy to trip on.

**graph_callers — HIGH-severity false-exhaustive (the headline finding):**
On `SimCoordinator::registerDomain` (echoes):
```
NO CALLERS for "SimCoordinator::registerDomain".
TRUST: lsp-verified-exhaustive (clangd, index-ready, compile-db ee85de48) — no callers found is a TRUSTWORTHY absence
```
But the caller verifiably exists: `engine/core/Engine_chunks.cpp:181  m_simCoordinator->registerDomain(*m_worldBufferDomain);`. **Reproduced after explicitly collecting the caller TU (`Engine_chunks.cpp`)** — still "NO CALLERS / TRUSTWORTHY absence."
**Reproduced on sand_castle:** `GPU::begin_frame` → `NO CALLERS ... lsp-verified-exhaustive ... TRUSTWORTHY absence`, while `game/main.cpp:1329  gpu.begin_frame()` is a real caller. Still wrong **after** collecting `game/main.cpp`.

The R1 *positive* absence-caveat (routing empties through a trust line) IS present — but it emits the **wrong** verdict: it certifies exhaustiveness whenever *any* index-ready collection exists for the repo, without checking the queried symbol was actually resolved by clangd.

**Positive path works:** `complete_in_flight_screenshot` (sand_castle, has an intra-TU LSP caller) renders correctly:
```
EDGE begin_frame→complete_in_flight_screenshot CALLS engine/gpu/GPU.cpp:2547 conf=0.95 [lsp✓]
TRUST: lsp-verified (clangd, index-ready, 1 caller, compile-db 23ae40ac, collected just now)
```
So `[lsp✓]` + TRUST rendering is correct **when LSP edges exist** (R1/I3 positive case PASS). The bug is strictly the **empty-result** path.

**Root cause (read in source):** `mcp/stdio/query/lsp-evidence.js` → `buildAbsenceTrustLine()` (lines 87-115). It calls `getLatestCollection(db)` and, if `collection.indexReady===true` and not stale-vs-HEAD, unconditionally returns *"lsp-verified-exhaustive … TRUSTWORTHY absence."* It never verifies (a) that THIS symbol was resolved by clangd, or (b) that caller-side TUs were in the collection. Empty ≠ exhaustive.
**Underlying clangd gap:** all LSP_VERIFIED edges in both graphs are **intra-file** (echoes 57, sand_castle 189 — verified via sqlite); cross-TU callsites are absent. This is the documented P0-3 WSL/Linux-compile-DB sysroot limitation: clangd's background index isn't resolving cross-TU references here. The toolset must **degrade the absence verdict to non-exhaustive** in this state — exactly what `code_intel_references` already does correctly.

### 5. code_intel_hierarchy — PARTIAL (over-claims on empty)
`kind:subtypes` on `ISimDomain` (class) → **correct**: `ISimDomain → WorldBufferDomain`, both `[lsp✓]`, `exhaustive:true`. This is the trustworthy override path. **PASS.**
`kind:callers` on `registerDomain`:
- default col → `(no call hierarchy root at …:8:1)` yet still `evidence.exhaustive:true, confidence:high`.
- correct col (`col:22`, lands on the symbol) → root found, **1 node, 0 callers**, `TRUST: lsp-verified … exhaustive:true`. The real caller (`Engine_chunks.cpp:181`) is missing, but it's stamped high-confidence exhaustive. **Same over-claim class as #4 (Medium-High).**
*Rough edge (Med):* verbs default cursor `col:1`; methods rarely start at col 1, so callers/references silently miss unless the agent computes the column. Should fall back to symbol-name search within the line.

### 6. graph_trace — PASS (failure-path heavy)
`updateChunkStreaming → registerDomain`: `NO STATIC PATH within 7 hops`, explains the dynamic-dispatch boundary, inlines both endpoints verbatim+line-numbered ("treat as already Read"). Failure-path inlining works as designed.
*Rough edge (Low):* a failed trace whose endpoint is a 1258-line god-function emitted **451 lines / 22 KB (~6k tokens)**. Bounded and explained, but heavy. Also: arbitrary method pairs (`renderFrame→draw`) rarely connect because the static graph's cross-function edges are heuristic/AMBIGUOUS — trace is mechanically fine but the heuristic graph limits hit rate.

### 7. graph_explore — PASS
`[ISimDomain, registerDomain, WorldBufferDomain, SimCoordinator]` → bundled verbatim cat -n source for 4 symbols across 4 files, "Read-equivalent" framing. Clean and budget-capped.
*Rough edge (Low):* `SimCoordinator` resolved to a **forward declaration** (`class SimCoordinator;` Engine.h:51) instead of the class def in SimCoordinator.h — resolution picks first match, not the definition.

### 8. graph_shader — PASS (worktree noise)
`pcas_powder.comp.glsl` → real BINDING TABLE (set.binding / access / kind / block) + LOADED BY C++ sites + a clearly-labeled heuristic BINDING CONTRACT. Good honesty banner ("static structural link … not a compiler/descriptor-layout check").
*Rough edges:*
- *(Medium)* `.claude/worktrees/agent-*/...` shader+loader copies are indexed first-party: **15 LOADS sites where ~5 are real + 10 stale worktree dupes**, plus a whole duplicate "SHADER" block for the worktree copy. The graph should exclude `.claude/worktrees/`.
- *(Low)* writer-detection found 0 C++ writers for all 9 bindings despite 15 load sites → the contract column ("no C++ writer found — verify") adds little signal here.

### 9. graph_explain_diff — PASS (2 rough edges)
`a9bcb80..8b3a238` → changed files → per-file symbols (incl GLSL) → affected_1hop (with provenance) → tests_adjacent → `risk:{score:2, band:LOW, formula, flags[]}`. Solid, structured, useful.
*Rough edges:*
- *(Medium)* `layers:{available:false}` — echoes has no `architecture.json` intelligence overlay, so the layer-span dimension (a headline feature of this verb) is empty (note says run `/graph-build-intelligence`).
- *(Low) Mojibake:* em-dashes render as `Ä�ā‚¬ā€"` (UTF-8 `—` mis-decoded) inside `note` and `flags` strings — an output-encoding bug in explain_diff assembly.

### 10. graph_neighbors OVERRIDDEN_BY (R2a) — PASS on method, empty on class
R2a **is wired** — but on the **method** node, not the class:
`ISimDomain::registerChunks` `{edge_types:[OVERRIDDEN_BY]}` →
`EDGE …→… OVERRIDDEN_BY :0 conf=0.70 prov=INFERRED` + `TRUST: heuristic only (tree-sitter) …` (correct — INFERRED, not exhaustive).
Querying the **class** `ISimDomain` returns NO NEIGHBORS, because the 15 OVERRIDDEN_BY edges (verified via sqlite) are method→method (base virtual → override), all `prov=INFERRED` — there is no class-level override edge. Structurally correct but counterintuitive vs the task's "returns overrides on a CLASS" expectation.
*Rough edges:*
- *(Med)* the class-level empty case ALSO printed `lsp-verified-exhaustive … TRUSTWORTHY absence` — doubly wrong, since OVERRIDDEN_BY edges are INFERRED, never LSP. Same bug as #4.
- *(Med) phantom nodes:* `graph_whereis ISimDomain` returns **5** `class ISimDomain` nodes (GpuSimFramework.h:22, GpuStructuralStress.h:17, PlayerMovementSystem.h:11, VoxelInteractionSystem.h:11, sim/ISimDomain.h:110). Only the last is real; the others are forward-decls/usages misextracted as class definitions.
- *(Low) doubled-namespace rendering:* candidates render as `…::SimCoordinator::SimCoordinator::registerDomain` and `…::ISimDomain::ISimDomain::registerChunks` — the enclosing-scope qualifier is duplicated.

### 11. Trust-vocabulary consistency (R2b) — FAIL (Medium-High)
Same symbol `SimCoordinator::registerDomain`, same (empty) caller set, four different verdicts:
| Verb | Verdict |
|---|---|
| `graph_callers` | `TRUST: lsp-verified-exhaustive … TRUSTWORTHY absence` |
| `code_intel_hierarchy callers` | `lsp-verified … exhaustive:true, confidence:high` |
| `graph_change_plan` | `TRUST: heuristic only (tree-sitter) …` + `RISK SAFE — 0 callers — proceed` |
| `code_intel_references` | `result_state:not_found_after_retry, exhaustive:false, "absence claims unsafe"` |
R2b's "one unified lsp-verified/partial/heuristic vocabulary" is **not** holding on the absence path. `code_intel_references` is the only honest one; `change_plan` is honest on TRUST but still flashes a green "RISK SAFE — proceed" for a symbol with a real caller.

### 12. sand_castle spot-check — PASS (mirrors echoes findings)
`graph_health`: good summary; **flagged staleness** (indexed fea5995, HEAD fd4b4c5); honestly surfaced a broken overlay (`overlay=broken 9/9, tests 0/9, docs 0/9`). `graph_digest`: works, staleness-warned, 28 bindings/22 loads. `graph_collect_code_intel` on `engine/gpu/GPU.cpp`: completed (`indexReady:true`, 544 refs / 322 defs / 24 diags, 13.5s). `graph_callers GPU::begin_frame`: reproduced the #4 false-exhaustive. `graph_callers complete_in_flight_screenshot`: positive `[lsp✓]` path works.

---

## Rough edges / bugs by severity

**HIGH**
1. **False-exhaustive absence** (`graph_callers`, `code_intel_hierarchy callers`, `graph_neighbors`). Empty LSP result + any index-ready collection ⇒ `lsp-verified-exhaustive — TRUSTWORTHY absence` / `exhaustive:true`, even when the symbol was never resolved and real callers exist. Reproduced on both repos on "safe to delete?" symbols. Root: `lsp-evidence.js buildAbsenceTrustLine()` (and the hierarchy evidence builder) don't gate on per-symbol resolution. This breaks the core trust promise.

**MEDIUM**
2. **Trust vocabulary not unified on the absence path** (R2b regression) — 4 verbs give 4 verdicts for the same empty caller set (#11).
3. **Worktree/scratch pollution** — `.claude/worktrees/agent-*/…` and `tools/probe_*.py` indexed as first-party; inflates hotspots, shader loaders (#8), and duplicate shader blocks. Add an ignore for `.claude/worktrees/`.
4. **Phantom `class ISimDomain` nodes** (5×) from forward-decls/usages (#10).
5. **graph_packet rejects bare symbols** despite the playbook advertising them (#3).
6. **explain_diff `layers` unavailable** without the intelligence overlay — a headline dimension silently empty (#9).
7. **col:1 default** makes hierarchy/references silently miss method symbols unless the agent computes the column (#5).

**LOW**
8. `graph_collect_code_intel language` required-with-no-default (inconsistent with all other code_intel verbs).
9. Mojibake (em-dash → `Ä�ā‚¬ā€"`) in `graph_explain_diff` strings.
10. Doubled-namespace rendering in ambiguous-match candidates.
11. `graph_explore`/symbol resolution prefers forward-decls over definitions.
12. Status-doc shader counts stale (988/308 vs documented 212/86).
13. Failed `graph_trace` can be ~6k tokens when an endpoint is a god-function.

---

## Top 3 issues to fix (priority order)

1. **Gate the absence verdict on per-symbol clangd resolution, not repo-level "a collection exists."** In `buildAbsenceTrustLine` (and `code_intel_hierarchy` callers): only emit `lsp-verified-exhaustive` when clangd actually *resolved this symbol* AND returned an empty caller set (mirror `code_intel_references` `evidence.exhaustive`). Otherwise emit the non-exhaustive "verify with rg / cross-TU index incomplete" caveat. This is the disqualifying bug.
2. **Unify the absence-path trust vocabulary (finish R2b).** Route `graph_callers`, `code_intel_hierarchy`, `graph_neighbors`, and `graph_change_plan` empties through the SAME evidence object `code_intel_references` uses, so one symbol yields one verdict. `change_plan` must not print "RISK SAFE — proceed" on a heuristic-only/non-exhaustive caller set.
3. **Exclude `.claude/worktrees/` (and scratch `tools/probe_*.py`) from extraction.** Removes duplicate/stale first-party nodes that pollute hotspots, shader loaders, and disambiguation candidate lists; also fix the phantom forward-decl-as-class extraction.

---

## What's genuinely good (keep)
`graph_digest` orientation (~450 tok). `code_intel_hierarchy kind:subtypes` (true virtual-override path, `[lsp✓]`, exhaustive). `graph_explore` source bundling. `graph_shader` binding table + honesty banner. `graph_explain_diff` structure/risk formula. The **positive** `[lsp✓]` + `TRUST: lsp-verified (N callers)` caller rendering when edges exist. Staleness/dirty warnings are surfaced consistently and honestly. Type-aware disambiguation beats grep noise. The pieces are strong; the absence-path trust labeling is the one thing standing between this and "really good."
