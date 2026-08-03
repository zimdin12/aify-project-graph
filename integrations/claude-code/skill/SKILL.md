---
name: aify-project-graph
description: Use AT THE START of any session in a repo that has `.aify-graph/` — the precomputed briefs are the fastest way to orient and often avoid 2-5 shell calls. Also use when planning changes, tracing execution, or pulling cross-layer context. Prefer static briefs first; use live verbs only for precision queries the brief cannot answer. If `.aify-graph/` is missing, run `/graph-build-all` to create it.
---

# aify-project-graph

This graph is a **map**, not the source of truth. Use it to narrow the search space, then read the real files before changing code.

## FIRST ACTION in any session

Before calling any other tool, check whether this repo has a graph:

```bash
ls .aify-graph/brief.agent.md 2>/dev/null
```

If it exists, **read it first** — it's 300-1100 tokens of dense orientation (grows with public-API surface size and PATHS depth). Sections (in order): `REPO` stats · `LANG` · `TOOLING` (major libs from manifests) · `COVERS` (what the brief is actually about) · `ENTRY` · `EXPORTS` (public API surface — verbs, routes, package exports) · `SUBSYS` · `FEATURES` (if overlay populated) · `INTERNAL_HUBS` (high-fan-in helpers — NOT public API; those are in EXPORTS) · `PATHS` (pre-computed execution chains for top EXPORTS — answers trace-shape questions from context) · `READ` · `TESTS` · `RECENT` · `TRUST`. Much cheaper than exploring with shell.

- For orient / onboarding: read `brief.agent.md` or `brief.onboard.md`
- For change-planning: read `brief.plan.md` (has `open:` / `tests:` / `load:` per feature)
- For cross-layer context on a specific thing: `graph_pull(node="X")`

If `.aify-graph/` is missing, tell the user to run `/graph-build-all` — it builds everything in one pass.

If the user wants to **see** the graph visually (not just query it), run `/graph-dashboard` — launches an interactive 2D multi-layer view in the browser with code + features + tasks + docs + cross-layer edges.

## Flagship traversal verb: `graph_consequences(target)`

The verb to call **before planning a non-trivial change** — answers "what breaks if I touch X?" by traversing every layer at once. Input: a symbol name OR a repo-relative file path. Output:

- Contracts potentially affected (from feature.contracts the symbol anchors into)
- Features touching the symbol (from anchors)
- Open tasks on those features
- Adjacent test files
- Last-touched git history
- Risk flags (no adjacent tests, orphan code, contract count)

Per the 2026-04-21 A/B bench: 0 of 8 test agents asked for this because the verb didn't exist; they all reached for `find`/`whereis` instead. This is the verb you actually want for cross-cutting planning.

Don't use this for simple lookups (Grep wins). Use it when the *consequence chain matters* — refactor planning, pre-delete safety check, contract-impact review.

## Fastest health check: `graph_health()`

Single-call synthesis of "is the graph usable right now?" — returns a one-line summary plus structured fields (trust level, unresolved-edge count, staleness, overlay validity). Use this instead of stringing `graph_status` + `graph_index` + parsing `brief.plan.md`'s TRUST line. Example output:

```
nodes=6452 edges=19147 · trust=weak (5227 unresolved) · fresh · overlay=clean (10 features)
```

If the summary includes `rebuild-incomplete: status=indexing`, do **not** keep hammering live read verbs. Run `graph_index(force=true)` out of band, or fall back to briefs + source reads until the rebuild finishes.

Read verbs are **snapshot-first**. The one exception is first use in a repo with no graph yet: that initial query may bootstrap the graph. After that, reads should not silently rebuild or mutate the graph under you. If the snapshot is incomplete or stale, treat that as an explicit routing signal:
- missing on first use → let the initial bootstrap happen, then switch to snapshot discipline
- stale / dirty working tree → use the current snapshot for orientation, then verify in source

`graph_health()` and the briefs now also surface two map-quality signals you should actually use:
- `OVERLAY:` / `OVERLAY GAPS:` — how many features have `tests[]`, `anchors.docs`, `depends_on`, `related_to`, and how many open tasks are actually linked. Thin overlay means the map will mostly orient, not dominate.
- Task-link strength matters too: the map now distinguishes `strong` code/tracker-linked tasks from `broad` future/spec mappings. Treat broad links as planning hints, not proof.
- `DIRTY:` / `DIRTY SEAMS:` — which mapped features currently intersect dirty files. If your bug/change target overlaps those files, trust current source + diff over cached structural inference.

Those signals are no longer health-only: `graph_consequences`, `graph_pull`, and `graph_change_plan` now surface dirty-seam / map-gap hints directly in their output, so planning verbs can tell you when the target sits inside an actively edited seam.

## Orientation walk: `graph_tour({steps, focus})`

Ordered N-step orientation walk for a repo you don't know yet: entrypoints → named subsystems (archetype regions like Physics/Rendering) → hotspots → cross-subsystem flows. Read top-to-bottom, then drill into anything with `graph_packet`. `focus` narrows to one subsystem (e.g. `focus:"physics"`). **Callable by name** — not in the default `tools/list`, so invoke it directly via `tools/call`.

## Find by meaning: `graph_search(mode:"semantic")`

`graph_search` defaults to `mode:"lexical"` (partial-name match). Pass `mode:"semantic"` to find code by **meaning** instead of name — opt-in embeddings (needs an embeddings sidecar). When no sidecar is present it **degrades to lexical + a hint**, so the call is always safe. Use semantic when you know what the code *does* but not what it's *called*; prefer `graph_whereis` for exact names.

## Freshness self-heal

`graph_index` is now in the default tool surface so a worker can refresh its own stale graph. If a read verb prints a **"graph stale"** warning (indexed commit behind HEAD), run `graph_index()` to refresh — or set `APG_AUTO_REINDEX=1` to auto-refresh on stale reads. Line numbers may have drifted until you do. A stale **"not found"** is NOT proof a symbol is gone — re-index before concluding a symbol was deleted.

**AFTER A FULL REBUILD, RE-COLLECT.** `graph_index(force=true)` (and any rebuild from a schema/extractor bump) DELETES the `[lsp✓]` trust spine. It is restored automatically only while the stored collection's commit still equals HEAD; once HEAD has moved it cannot be — re-stamping shifted line numbers as "verified" would be a lie. Measured on a real repo: a reindex left **0 verified edges of 17544 CALLS**, so every caller answer silently became heuristic-only and nothing could attest exhaustiveness. When `graph_index` returns `trustSpineDropped` / `nextAction`, or `graph_health` says **"trust spine EMPTY"**, run `graph_collect_code_intel` before trusting any "no callers / safe to delete" claim.

## Default pattern: MIXED mode (graph for orientation, Read/Grep for details)

Measured on the 2026-04-22 bench (9 agents × 3 variants × 3 task classes): **mixed mode beats pure graph-only by 8-19% tokens and matches no-graph on time, while producing the best DEBUG quality (32% fewer tokens, 33% less time than no-graph).** The winning shape is:

- **Graph for ORIENTATION questions** — "what features touch this? what tasks are on those features? who last edited? what contracts are nearby? what sibling bugs are open?" Call `graph_consequences`, `graph_pull`, `graph_health`, read the relevant brief.
- **Read/Grep for DETAIL questions** — "what line is this condition? what does this function actually do? is this hardcoded? what's the exact signature?"
- **For line-level audits (contract compliance, config-authority reviews): skip the graph entirely.** It adds cost without value on pure line-by-line work. No orientation need → no graph call.

The failure mode to avoid: calling graph_find once, getting empty, giving up. Use graph for the question it's shaped for; drop to Grep immediately when the question shape changes.

## Default workflow after reading the brief

1. **Use live verbs only when the brief is not enough** (precision queries)
2. **Verify in source files before acting** on anything the graph claims
3. **Read the `TRUST` line first — it gates which verbs are worth calling:**
   - `TRUST ok` → full verb suite earns its keep. `graph_impact`, `graph_whereis`, `graph_callers` are faster and cheaper than Grep-and-read on familiar territory.
   - `TRUST weak` → prefer **briefs + `graph_pull` + a single-term `graph_find` + Grep**. `graph_consequences` can still help on broader planning questions, but under weak trust it is advisory; `graph_pull` is usually the safer narrow live probe.
   - This is empirically measured on a real C++ planning task: TRUST=weak bench showed `graph_whereis` redundant with Grep; briefs + one `graph_find` did the heavy lifting and the other verbs broke even or lost.

**Honest measurement (2026-04-27):** multi-run signal across apg dogfood + the 2026-04-26 A/B bench shows briefs + overlay reliably save **~15-20% wall-clock and tool calls** vs Grep-only on planning shapes. Live verbs are conditionally helpful — surgical use (≤3 per planning task) adds precision the brief can't give; over-calling tips net negative. Single-bench headlines (e.g. earlier `−17.3%` postfix4 / `−23.1%` pre-walkback) carry small-n caveats; treat them as point estimates, not confident deltas. Older 2026-04-20 cross-runtime context: Claude Code + Opus saw **−19% to −34% tokens and 1.5-2.9× wall-clock** on shell-accessible tasks; Codex + gpt-5.4 was roughly parity aggregate. Reach for live verbs only when you need precision the brief can't answer.

## Use live verbs for

**Listed in every profile — reach for these first:**
- `graph_packet(target="X", mode="orient|plan|debug|review|audit|verify")` — **one-shot agent prompt packet (cheap+coarse)**. For `feature:<id>` / `task:<id>` targets, reads overlay+brief JSON directly with no freshness rebuild. Bare symbols may use one budgeted lookup to map symbol→feature and print `MATCHED VIA: ...`. Returns ~500-900 tokens: MODE / STATUS / FEATURES / SNAPSHOT / READ FIRST / CONTRACTS / TESTS / RISKS / LIVE. Reach for this first when the task is scoped to a feature or task; pick `mode` by workflow. **`mode="verify"`** is a post-edit decision packet: pass `files:[...]` (and optional `audited:true`) to get diagnostics on touched files + freshness verdict + `SOURCE_REQUIRED` when audited code changes. Pass `analyze:true` to fold bounded `clang-tidy` / compile-command evidence into the same packet. No target needed for verify.
- `graph_collect_code_intel(language="cpp", scope="all|changed|files", files=[...])` — public action verb to run a real code-intel collection (e.g. clangd over `compile_commands.json`). Imports the v0.2 collection into the local graph so subsequent `graph_health.codeIntel`, `graph_pull(layers:["code_intel"])`, `graph_change_plan`, and `graph_packet({mode:"verify"})` see compiler-backed evidence. Never auto-runs; explicit only.

**Languages (2026-06-02): the `code_intel_*` verbs + `graph_collect_code_intel` now drive a real language server for C++ (clangd), TypeScript/JavaScript (typescript-language-server), and Python (pyright).** Language is **inferred from the file extension** — you don't pass `language`. The servers are bundled with the plugin (no host/LSP setup). Honesty differs per language: C++ gated on compile-DB coverage; TS exhaustive only when the queried file is **inside its nearest `tsconfig.json`/`jsconfig.json` project** (a root tsconfig merely existing is not enough — out-of-scope files return `partial_tsconfig_scope`); **Python is never provably exhaustive** (duck typing / `getattr` / dynamic dispatch) so its references/hierarchy return `evidence.exhaustive=false` — a FLOOR, verify with rg before any delete/rename.

**Bounded live code-intel verbs (2026-05-12 — for inner-loop editing).** When you're mid-edit and need ONE bounded answer (diagnostics for these files, callers of this symbol, type at this position), use the bounded `code_intel_*` verbs FIRST — they drive the language server live, no collect/import cycle, return 5-12× less data than `graph_collect_code_intel`+`graph_pull`:
- `code_intel_diagnostics(files=[...])` — per-file errors with batch-warmup. Use after editing C++ to check for build errors without running a build. **Replaces "agent reads file → runs build → parses output."**
- `code_intel_references(file, line, col)` — symbol-aware refs via clangd, NOT text search. Returns `result_state: found|not_found_after_retry`. **Replaces grep.**
- `code_intel_definitions(file, line, col)` — defs across translation units. **Replaces "open header file, search."**
- `code_intel_hover(file, line, col)` — type signature + docstring at a position. **Replaces "read declaration."**
- `code_intel_symbols(file)` — document symbol outline. **Replaces "scan whole file."**
- `code_intel_analyze(files=[...], mode="clang-tidy"|"compile")` — bounded analyzer/build evidence for explicit files. Use when clangd diagnostics are not enough and you need `CLANG_TIDY` / `BUILD` provenance. **Multi-language:** C++ uses clang-tidy/compile; TS/JS/Python route through the language server's own diagnostics (mode reported as `lsp`, provenance `TS_LANGSERVER` / `PYRIGHT`).
- `code_intel_hierarchy(symbol, kind="callers"|"callees"|"supertypes"|"subtypes")` — call + type hierarchy via clangd. The trustworthy **transitive** path (who-calls-transitively, virtual overrides). Per-node `[lsp✓]` only when the index is ready; otherwise `lsp-partial`. For a `base*->virt()` callsite use call hierarchy on the virtual (or hierarchy on the owning class) plus static `OVERRIDDEN_BY` edges to see runtime overrides. A cold clangd no longer false-reports "no root" — the verb waits for the file's first parse then retries; if it still says "index/AST not confirmed ready", that's a retry signal (re-run after warmup), NOT "this symbol has no hierarchy".

Analyzer `partial` / `not_collected` means evidence was unavailable for some requested files; it is not the same as "analyzer ran clean."

**When to use which:** atomic C++ question (one symbol, one file) → bounded `code_intel_*`. Whole-task planning / feature review / orientation → `graph_packet`. Repo snapshot for ranked graph facts → `graph_collect_code_intel` then graph verbs. Audit / safety claims → always verify against source even with code-intel evidence.

**Compile-DB coverage gate (read the evidence, not just the result).** `code_intel_references` / `code_intel_hierarchy` only attest an EXHAUSTIVE caller set when the host clangd can actually compile every TU. When the `compile_commands.json` was built by a *different* toolchain than the host clangd (e.g. a Linux/WSL DB with `/mnt/c` paths run against Windows clangd) or is a CMake **unity/jumbo** build, the index is silently PARTIAL — some real callers are invisible. These verbs now detect that and return `evidence.degraded:true, cause:"partial_compile_db_coverage", exhaustive:false` with an "verify with rg before delete/rename" fallback **instead of a false `exhaustive:true`**. When you see that cause: do NOT treat the result as "no callers / dead code / safe to delete" — cross-check with Grep. To make the index actually complete, generate a NATIVE Windows compile DB so host clangd matches it. MSBuild does NOT emit `compile_commands.json`, so configure a Ninja+clang-cl build purely for the DB: `cmake -B build-win-clangd -G Ninja -DCMAKE_CXX_COMPILER=clang-cl -DCMAKE_EXPORT_COMPILE_COMMANDS=ON` — APG auto-discovers `build-win-clangd/`. `APG_CLANGD_WSL=1` (clangd under WSL against a Linux DB) is the fallback if a WSL build is still around.
- `graph_consequences(target="X")` — function-granular cross-cutting planning. Use when packet's coarse view loses precision.
- `graph_pull(node="X")` — cross-layer pull (code + features + tasks + activity). For overlay targets, prefer explicit forms like `feature:terrain-generation`, `feature/terrain-generation`, `task:CU-123`, or `task/CU-123`.
- `graph_change_plan(symbol="X")` — risk gate before editing high-fan-in symbols. SIGNALS line + ranked READ ORDER.
- `graph_health()` — single-call trust + freshness + overlay summary.

**Tradeoff:** packet is cheapest for feature/task targets because it avoids freshness rebuilds and SQL, but it is coarser. Bare-symbol packet calls can spend one lookup to find the owning feature. If packet's MATCHED VIA shows a symbol→feature mapping you want depth on, escalate to `graph_consequences` or `graph_change_plan`. Default-routing everything to packet trades quality for cost — use it for initial context, escalate for depth.

**Hard budget on a planning task: at most 1 brief read + 3 live verb calls.** Measured 2026-04-26 A-v2 bench: an agent that made 7 live verb calls (`graph_find` ×4, `graph_file` ×2, `graph_consequences` ×1) ended up +52% tokens / +15% wall-clock vs the same task with no graph at all. Each `graph_find`/`graph_consequences`/`graph_file` returns hundreds-to-thousands of context tokens; over-calling them tips the budget the wrong way. **0 live calls is often correct** after reading the brief. If your first 1-2 live calls return thin/empty results, drop to Grep — don't keep retrying with rephrased queries. `graph_find` already auto-tokenizes compound queries (since 2026-04-21), so thin results are the data, not a query bug.

**Listed ≠ callable.** Your `tools/list` shows a focused subset; every other verb stays callable by name via `tools/call`. Read the tool descriptions for what each one does — this skill does not re-list them, because a hand-maintained catalogue here drifts out of step with the server. Long-tail verbs worth knowing exist: `graph_preflight` / `graph_path` / `graph_find` / `graph_callees` / `graph_neighbors` / `graph_file` / `graph_shader` and the `graph_overview` / `graph_hotspots` / `graph_cycles` analytics behind `graph_digest`. Caveat: a host that defers MCP tools behind a search step can only reach **listed** verbs — if a tool-search finds one of these, do not retry; use a listed verb or start the server with `--toolset=full`.

**Trust rule:** `[lsp✓]` / `LSP_VERIFIED` = language-server ground truth — don't re-grep it. Absence claims gate on `evidence.exhaustive === true`, never on an empty result.

## Edge provenance

Some verbs surface `prov=...` on edges:
- `EXTRACTED` — direct AST/source edge. Highest trust.
- `CODE_INTEL` — optional compiler/LSP-derived fact imported through `scripts/import-code-intel.mjs`. Treat as higher precision than tree-sitter guesses, but still source-verify before editing.
- `INFERRED` — deterministic framework/heuristic synthesis. Lower trust; verify in source.
- `AMBIGUOUS` — fallback resolution where multiple plausible targets remained. Lowest trust.

When ranking impact or path output, treat `INFERRED` and especially `AMBIGUOUS` edges as routing hints, not proof.

## Use grep/read first for

- exact lookup when you already know the area
- single-file debugging
- checking real code text, conditions, signatures, comments
- any situation where trust is weak and the graph may be incomplete
- **per-line granularity questions** — `graph_callers` is function-granular; if you need "which LINE called X," Grep wins by schema (measured on a C++ engine repo: graph collapses many in-function sites to one edge)
- **symbols appearing in >10 files** — `graph_whereis` tends to lose to Grep here; the candidate set is too wide for graph's exact-match advantage to kick in

**"Skip graph" ≠ "do less."** Audit-shaped tasks ("find every X") need **N targeted Grep + Read passes**, not one. 2026-04-27 AUDIT bench: a graph-allowed agent did 1 grep, missed 80% of hits. Single-grep audits are wrong by schema.

**On weak-trust graphs (C++ cross-file dispatch, PHP traits/Eloquent, dynamic dispatch), `graph_impact` and `graph_callers` undercount silently.** 2026-04-27 IMPACT bench: `graph_impact() on a high-fan-in voxel setter` returned 2 callers when grep found ~65, leading to a wrong "GO" recommendation. Same shape on Laravel: trait-method calls (`$this->log()` from a trait) and Eloquent `Builder` chains (`->findOrFail()` on a query builder) often miss. Both verbs now print a CONFIDENCE footer when result count looks suspiciously thin — read it. **Before any deletion, rename, or signature change on a weak-trust graph, cross-check with Grep.** The graph result is a lower bound, not the answer.

## When NOT to use graph verbs (anti-patterns)

- Do NOT use `graph_impact` / `graph_whereis` as a substitute for reading code. They tell you *what connects*, not *what the code does*.
- Avoid broad compound `graph_find("A B C")` queries. The verb now auto-tokenizes, but broad searches still bloat context; prefer one strong keyword when possible and drop to Grep if results are thin.
- Do NOT reload graph tool schemas (ToolSearch) speculatively. If you're not going to use graph verbs, don't pay the schema-load cost.

## Hard rules

- Do not rely on the graph without reading the target files.
- Do not prefetch lots of graph verbs “just in case.”
- Do not call graph verbs in parallel.
- If trust is weak, be more conservative and read more source.
- Keep the ignore files straight:
  - `.gitignore` should contain `.aify-graph/`
  - `.aifyignore` is for extra local scratch/build dirs or path/glob patterns that should not be indexed
  - `.aifyinclude` opts default-ignored dirs back in
- **Mine the overlay links before planning.** When planning a feature X, don't stop at the brief — open `functionality.json` (or `brief.json.features`) and read `X.contracts[]` doc-by-doc, skim related `brief.json.features.valid[].tasks[]` for X (shipped so you don't re-parse `tasks.json`), and check `X.depends_on` + `X.related_to`. The graph stores these links; plans routinely ignore them. That's a skill-prompt failure, not a tool limitation.
- **Use explicit `tests[]` in functionality.json when inference is weak.** On repos with one shared test entrypoint (for example a single `tests/test_main.cpp`), automatic test attribution is often too weak. Put `tests: ["tests/test_main.cpp"]` on the relevant features so `brief.plan.md` stops pretending there is no test anchor.
- **Map quality is overlay quality.** If a repo still feels thin after a clean rebuild, the next fix is usually richer overlay data: `tests[]`, `depends_on`, `related_to`, and `anchors.docs` for feature contracts. Those fields improve planning/debug quality more than another raw code query.
- **Reach for `graph_impact` on cross-cutting tasks.** Any plan that touches more than one feature should call `graph_impact(symbol=...)` on the central symbol before writing steps. Search-style verbs (`graph_find`, `graph_whereis`) are for lookup; `graph_impact` is for "what breaks if I touch this" — that's what cross-cutting planning actually needs.
- **Line-number citations must be Read-verified.** If you write `file.ext:42` in a plan or doc, the line has to have been Read in the same session. Graph verbs print line numbers confidently even when the underlying index is weak — citing them unverified creates a false grounding signal. If you don't want to Read, write the citation as `file.ext:~42 (unverified)`.

## Good patterns

### Orientation
- read `brief.agent.md`
- if still fuzzy on full profile: `graph_report()` or `graph_onboard(path="...")`
- on lean profile: use `graph_pull(node="<subsystem-dir>")` instead — same data across layers

### Planning a change
- read `brief.plan.md`
- call `graph_change_plan(symbol="X")`
- if the change crosses layers, call `graph_pull(node="X")`
- read the 1-3 files it points you to

### Trace / routing
- call `graph_path(symbol="X")`
- verify the returned files in source

### Edit safety
- call `graph_preflight(symbol="X")`
- obey the SAFE / REVIEW / CONFIRM decision

## Pre-action graph consultation

Before doing anything risky or destructive, consult the graph. This is a class of high-value moves agents often skip:

| about to do | risk | verb to call first | what it tells you |
|---|---|---|---|
| Delete a file | breaks callers, orphans features/tasks/tests | `graph_pull(node="path/to/file.ext", layers=["code","functionality","tasks","relations"])` | every symbol defined here + callers + features anchored + tasks referencing |
| Rename or move a symbol | breaks every caller | `graph_impact(symbol="X")` | blast radius ranked by depth + confidence |
| Remove a route or endpoint | breaks API consumers, framework hooks | `graph_impact(symbol="handler")` + grep route table | consumers + framework wiring |
| Merge two features | anchor overlap, dep conflict | `graph_pull(node="featureA")` + `graph_pull(node="featureB")` | overlap diff |
| Extract a module / split a file | exposes hidden coupling | `graph_pull(node="src/file.ext", layers=["relations","code"])` | external deps in/out |
| Bump or remove a dependency | breaks every importer | `graph_pull(node="dep-name")` | importers list |
| Edit a high-fan-in symbol | many consumers may regress | `graph_preflight(symbol="X")` | SAFE / REVIEW / CONFIRM gate |
| Review a PR | what subsystems/features affected | `graph_pull(node="file")` for each touched file | feature attribution per file |

Most of these compose existing verbs — no special workflow needed. The value is **remembering to ask** before acting. If the task looks destructive or cross-cutting, reach for the graph first.

## Reality check

What the graph does well:
- repo orientation
- narrowing a change-reading set
- showing callers / impact / path / feature context

What it does not do:
- replace file reading
- know runtime-only behavior
- guarantee completeness when trust is weak
