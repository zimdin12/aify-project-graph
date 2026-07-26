---
name: graph-dashboard
description: Use when the user says "open the graph dashboard", "show me the graph visually", "I want to see the feature layout", or asks for a visual view of the project graph. Launches the interactive 2D multi-layer dashboard (code + features + tasks + docs + cross-layer edges). Works in lean and full profile.
---

# graph-dashboard

Open the interactive visual dashboard for the current repo's graph.

## What it is

A rebuilt interactive graph viewer in the user's default browser, available in **2D and 3D**. The default front door is the **Map** view: a navigable set of labeled "group-box" clusters you **drill into** (double-click a box, or `⊕`, to expand it; double-click a node to focus its group). It shows the same multi-layer graph (code + features + tasks + docs + cross-layer edges) but legibly grouped instead of as a hairball.

Layers shown:
- **Code layer** — sized by node kind (Class/Function/File/etc.)
- **Feature layer** — from `functionality.json`
- **Task layer** — from `tasks.json`
- **Doc layer** — Document nodes
- **Cross-layer edges** — dashed (curated, e.g. feature→file anchors) or dotted (inferred, e.g. doc→code MENTIONS)
- **Code edges** — relation-colored (CALLS, REFERENCES, IMPORTS, etc.)

### Map grouping modes (toggle pills at the top of the panel)

- **by directory** — boxes are directories; `groupDepth` controls how deep the folder roll-up goes. Best for "what's the shape of this repo."
- **by archetype** — merges communities of the *same purpose* into named boxes (Physics, Rendering, Tests, …) — roughly ~15 legible boxes instead of hundreds of raw communities.
- **by community** — raw detected graph communities (the precomputed Leiden ids). Use when you want graph-derived clusters rather than directory- or purpose-derived ones.

### Tools in the panel

- **Search-to-focus** — type a symbol/file/feature; pick a result to jump the view to that node and its group.
- **Blast radius** — toggle blast mode and click a node: changed node + affected neighbors highlight, everything else fades.
- **Pathfinder** — enter a `from` and `to` node to draw the path between them.
- **Guided Tour** (🧭) — an ordered orientation walk (entrypoints → subsystems → hotspots); each step's symbols are click-to-focus pills.
- **Inline source** — click a code node → "show source" to read its line range without leaving the dashboard.
- **PNG export** (⤓) — save the current 2D/3D view as an image.
- **Navigation history** — a "← back" control in the node detail retraces your click-through path.
- **Hover tooltip** — hover a node for its kind + in/out/total connection counts (degree at a glance).
- **File tree** (📁 Files) — a collapsible folder→file tree of every indexed file; click a file to focus its node and open its source. Best for "take me to file X" navigation when you know the path.
- **Changes** (◆ Changes, 2D only) — highlights nodes in files changed vs `HEAD` (uncommitted + untracked) using a real `git diff`: changed-file nodes light up red, their neighbors amber, the rest fade. A blast-radius seed from what you actually touched — best in Force/Tree/Flow or after drilling into a Map box (grouped Map collapses the leaf nodes). Shows the changed-file count in the button; click again to clear.
- **Trust lens** (all / ✓ verified / ~ heuristic) — isolates the clangd-verified call spine. "verified" shows only `[lsp✓]` LSP_VERIFIED call edges (ground truth); "heuristic" shows only the unverified call edges that still need checking; structural edges (CONTAINS/IMPORTS) always stay. The header shows what % of call edges are clangd-verified. Best in Force/Tree/Flow or a drilled box. Use it to answer "which of these call relationships can I actually trust" — visible only after `graph_collect_code_intel` has run.
- Layer/node-type filters to toggle layers independently.
- The dashboard titles itself after the indexed project (the repo's directory name), so it's clear which project you're looking at when you point it at several repos.
- Large graphs: the per-node views (Force/Shader/Tree/Flow, all 3D views) cap to the top ~3000 nodes by degree so a heavy pick can't freeze the UI (a note says how many of how many; filter or use the grouped Map to see all).

## Steps

1. **Call the verb:**
   ```
   graph_dashboard()
   ```
   Returns `{url, port}` like `http://127.0.0.1:54321`. (For local dev you can instead run `node launch-dash.mjs`, which serves the same dashboard on a local port.)

2. **Tell the user the URL** and optionally what they'll see first:
   > Dashboard running at http://127.0.0.1:54321 — open it in your browser. The Map view shows labeled group boxes (by directory / archetype / community); double-click a box to drill in. Search-to-focus, blast radius, and pathfinder are in the left panel.

3. **Let the dashboard run.** The server stays up until the user closes the session or kills the process. No further action from the agent.

## When to use which view

- **Understanding a new repo** — start in **Map / by archetype**, then drill into a named box (Physics, Rendering, …)
- **Feature ownership mapping** — turn off code layer, show only features + tasks + their cross-layer edges
- **Impact analysis preview** — use **blast radius**: toggle blast mode, click a node; changed + affected light up, the rest fade
- **"How does A reach B"** — use **pathfinder**: enter the two endpoints to draw the path
- **Documentation coverage check** — show only doc + code layers, see which files have MENTIONS edges (inferred doc coverage)

## View modes

Pills at the top of the panel switch the layout. Available modes depend on 2D vs 3D:

- **Map** (default, both 2D and 3D) — labeled group boxes you drill into; grouping is one of by directory / by archetype / by community (see above).
- **Tree** (2D) — directory-tree dagre layout. Files cluster under their parent dir. Best for "what's the shape of this repo" orientation.
- **Flow** (2D) — directed dagre flow layout for following call/edge direction.
- **Layers** (3D) — code/features/tasks/docs separated into stacked planes. Use for cross-layer questions ("which features touch this subsystem").
- **Force** (both) — unconstrained physics simulation. Slow on large graphs (>3000 nodes auto-falls back to grouped positioning).
- **Shader** — the C++↔GLSL shader-binding bridge subgraph.

3D mode is best for layer separation; 2D is best for tree/flow orientation. The **open 3D / open 2D** link in the sidebar header switches between them.

## Profile note

This verb is in the **full profile**. On lean profile installs (Codex/OpenCode default), the verb is hidden from `tools/list` but **still callable by name via `tools/call`**. If the user reports "tool not found," ensure you're calling it as `graph_dashboard`, not `/graph_dashboard`.

If the user is on lean and wants dashboard access surfaced, they can remove `--toolset=lean` from the MCP config args and restart.

## Prerequisites

- `.aify-graph/graph.sqlite` must exist (built by `graph_index()` or the `graph-build-all` skill)
- `.aify-graph/functionality.json` optional — without it, feature/task layers simply don't appear
- `.aify-graph/tasks.json` optional — same, shows up when present

If the user says "the dashboard is empty of features/tasks", tell them to run `/graph-build-functionality` and/or `/graph-build-tasks` first.

## What NOT to do

- Don't keep calling `graph_dashboard()` if it's already returned a URL — subsequent calls will start another server on a different port. One is enough.
- Don't try to render the graph yourself. The dashboard server is the rendering path; the MCP verbs (`graph_pull`, `graph_path`, etc.) are the data path.
- Don't describe individual nodes in prose if you could just send the user to the dashboard. The dashboard exists precisely for visual exploration.
