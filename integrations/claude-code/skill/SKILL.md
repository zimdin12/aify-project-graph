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

## Default workflow after reading the brief

1. **Use live verbs only when the brief is not enough** (precision queries)
2. **Verify in source files before acting** on anything the graph claims

The benchmark result (2026-04-20 cross-tester, matched-N): briefs are **1.5-2.9× faster wall-clock and −19% to −34% tokens on Claude Code Agent + Opus** for shell-accessible tasks; on **Codex + gpt-5.4** the same shapes are **roughly parity-to-slight-regression aggregate (+3.6% tok / +11.3% dur matched 11-vs-11)** — codex's prompt caching flattens the savings. Quality is **non-regressing** on both runtimes. Quality GAINS show up on overlay-dependent tasks (requires `functionality.json` populated): **baseline 2/4 clean → brief 4/4 clean, −18% tok, −51% dur on Codex**. Reach for live verbs only when you need precision the brief can't answer.

## Use live verbs for

**Lean profile** (default for Codex/OpenCode install, 3 verbs listed in `tools/list`):
- `graph_change_plan(symbol="X")` — safe change planning
- `graph_path(symbol="X")` — execution / route / middleware flow
- `graph_impact(symbol="X")` — blast radius

**Still callable in lean mode** (by name via `tools/call`, just hidden from `tools/list` to reduce manifest tax):
- `graph_preflight(symbol="X")` — edit safety gate for high-fan-in symbols
- `graph_pull(node="X")` — cross-layer pull (code + features + tasks + activity)
- `graph_find(query="X")` — cross-layer disambiguator (NOT an rg replacement)

**Full profile only** (Claude Code default): `graph_lookup`, `graph_whereis`, `graph_search`, `graph_callers`, `graph_callees`, `graph_neighbors`, `graph_report`, `graph_onboard`, `graph_file`, `graph_module_tree`, `graph_dashboard`, `graph_summary`, `graph_status`, `graph_index`.

## Use grep/read first for

- exact lookup when you already know the area
- single-file debugging
- checking real code text, conditions, signatures, comments
- any situation where trust is weak and the graph may be incomplete

## Hard rules

- Do not rely on the graph without reading the target files.
- Do not prefetch lots of graph verbs “just in case.”
- Do not call graph verbs in parallel.
- If trust is weak, be more conservative and read more source.

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
