---
name: aify-project-graph
description: Use AT THE START of any session in a repo that has `.aify-graph/` — the precomputed briefs are the fastest way to orient and often avoid 2-5 shell calls. Also use when planning changes, tracing execution, or pulling cross-layer context. Prefer static briefs first; use live verbs only for precision queries the brief cannot answer. If `.aify-graph/` is missing, run `/graph-build-all` to create it.
---

# aify-project-graph

This graph is a **map**, not the source of truth. Use it to narrow the search space, then read the real files before changing code.

## Flagship traversal verb: `graph_consequences(target)`

The verb to call **before planning a non-trivial change** — answers "what breaks if I touch X?" by traversing every layer at once. Input: a symbol name OR a repo-relative file path. Output:

- Contracts potentially affected (from feature.contracts the symbol anchors into)
- Features touching the symbol (from anchors)
- Open tasks on those features
- Adjacent test files
- Last-touched git history
- Risk flags (no adjacent tests, orphan code, contract count)

Per the 2026-04-21 echoes A/B: 0 of 8 test agents asked for this because the verb didn't exist; they all reached for `find`/`whereis` instead. This is the verb you actually want for cross-cutting planning.

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

## Default pattern: MIXED mode (graph for orientation, Read/Grep for details)

Measured on the 2026-04-22 echoes bench (9 agents × 3 variants × 3 task classes): **mixed mode beats pure graph-only by 8-19% tokens and matches no-graph on time, while producing the best DEBUG quality (32% fewer tokens, 33% less time than no-graph).** The winning shape is:

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
   - This is empirically measured on a real echoes planning task: TRUST=weak bench showed `graph_whereis` redundant with Grep; briefs + one `graph_find` did the heavy lifting and the other verbs broke even or lost.

**Honest measurement (2026-04-27):** multi-run signal across apg dogfood + 2026-04-26 echoes A/B shows briefs + overlay reliably save **~15-20% wall-clock and tool calls** vs Grep-only on planning shapes. Live verbs are conditionally helpful — surgical use (≤3 per planning task) adds precision the brief can't give; over-calling tips net negative. Single-bench headlines (e.g. earlier `−17.3%` postfix4 / `−23.1%` pre-walkback) carry small-n caveats; treat them as point estimates, not confident deltas. Older 2026-04-20 cross-runtime context: Claude Code + Opus saw **−19% to −34% tokens and 1.5-2.9× wall-clock** on shell-accessible tasks; Codex + gpt-5.4 was roughly parity aggregate. Reach for live verbs only when you need precision the brief can't answer.

## Use live verbs for

**Lean profile** (default for Codex/OpenCode install, 5 verbs listed in `tools/list`):
- `graph_packet(target="X")` — **one-shot agent prompt packet (orientation, cheap+coarse)**. Reads overlay+brief JSON directly, no SQL, no freshness rebuild. Returns ~500-900 tokens: STATUS / FEATURES / SNAPSHOT / READ FIRST / CONTRACTS / TESTS / RISKS / LIVE. Pass `feature:<id>`, `task:<id>`, or a bare symbol (auto-resolves via consequences with `MATCHED VIA: ...` line). Reach for this first when the task is scoped to a feature or task.
- `graph_consequences(target="X")` — function-granular cross-cutting planning. Use when packet's coarse view loses precision.
- `graph_pull(node="X")` — cross-layer pull (code + features + tasks + activity). For overlay targets, prefer explicit forms like `feature:terrain-generation`, `feature/terrain-generation`, `task:CU-123`, or `task/CU-123`.
- `graph_change_plan(symbol="X")` — risk gate before editing high-fan-in symbols. SIGNALS line + ranked READ ORDER.
- `graph_health()` — single-call trust + freshness + overlay summary.

**Tradeoff:** packet is the cheapest (~80-150 ms, no SQL) but coarsest. If packet's MATCHED VIA shows a symbol→feature mapping you want depth on, escalate to `graph_consequences` or `graph_change_plan`. Default-routing everything to packet trades quality for cost — use it for orient, escalate for depth.

**Hard budget on a planning task: at most 1 brief read + 3 live verb calls.** Measured 2026-04-26 echoes A-v2 bench: an agent that made 7 live verb calls (`graph_find` ×4, `graph_file` ×2, `graph_consequences` ×1) ended up +52% tokens / +15% wall-clock vs the same task with no graph at all. Each `graph_find`/`graph_consequences`/`graph_file` returns hundreds-to-thousands of context tokens; over-calling them tips the budget the wrong way. **0 live calls is often correct** after reading the brief. If your first 1-2 live calls return thin/empty results, drop to Grep — don't keep retrying with rephrased queries. `graph_find` already auto-tokenizes compound queries (since 2026-04-21), so thin results are the data, not a query bug.

**Still callable in lean mode** (by name via `tools/call`, just hidden from `tools/list` to reduce manifest tax):
- `graph_preflight(symbol="X")` — edit safety gate for high-fan-in symbols
- `graph_path(symbol="X")` — execution / route / middleware flow
- `graph_impact(symbol="X")` — blast radius
- `graph_find(query="X")` — cross-layer disambiguator (NOT an rg replacement)

**Full callable surface** (Claude Code default; a few legacy aliases may stay hidden from `tools/list`): `graph_lookup`, `graph_whereis`, `graph_search`, `graph_callers`, `graph_callees`, `graph_neighbors`, `graph_report`, `graph_onboard`, `graph_file`, `graph_module_tree`, `graph_dashboard`, `graph_summary`, `graph_status`, `graph_index`, `graph_consequences`, `graph_health`.

## Edge provenance

Some verbs surface `prov=...` on edges:
- `EXTRACTED` — direct AST/source edge. Highest trust.
- `INFERRED` — deterministic framework/heuristic synthesis. Lower trust; verify in source.
- `AMBIGUOUS` — fallback resolution where multiple plausible targets remained. Lowest trust.

When ranking impact or path output, treat `INFERRED` and especially `AMBIGUOUS` edges as routing hints, not proof.

## Use grep/read first for

- exact lookup when you already know the area
- single-file debugging
- checking real code text, conditions, signatures, comments
- any situation where trust is weak and the graph may be incomplete
- **per-line granularity questions** — `graph_callers` is function-granular; if you need "which LINE called X," Grep wins by schema (measured on echoes: graph collapses many in-function sites to one edge)
- **symbols appearing in >10 files** — `graph_whereis` tends to lose to Grep here; the candidate set is too wide for graph's exact-match advantage to kick in

**"Skip graph" ≠ "do less."** Audit-shaped tasks ("find every X") need **N targeted Grep + Read passes**, not one. Echoes 2026-04-27 AUDIT bench: a graph-allowed agent did 1 grep, missed 80% of hits. Single-grep audits are wrong by schema.

**On weak-trust graphs (C++ cross-file dispatch, PHP traits/Eloquent, dynamic dispatch), `graph_impact` and `graph_callers` undercount silently.** Echoes 2026-04-27 IMPACT bench: `graph_impact("ChunkManager::setVoxel")` returned 2 callers when grep found ~65, leading to a wrong "GO" recommendation. Same shape on Laravel: trait-method calls (`$this->log()` from a trait) and Eloquent `Builder` chains (`->findOrFail()` on a query builder) often miss. Both verbs now print a CONFIDENCE footer when result count looks suspiciously thin — read it. **Before any deletion, rename, or signature change on a weak-trust graph, cross-check with Grep.** The graph result is a lower bound, not the answer.

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
