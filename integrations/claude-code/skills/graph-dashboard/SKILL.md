---
name: graph-dashboard
description: Use when the user says "open the graph dashboard", "show me the graph visually", "I want to see the feature layout", or asks for a visual view of the project graph. Launches the interactive 2D multi-layer dashboard (code + features + tasks + docs + cross-layer edges). Works in lean and full profile.
---

# graph-dashboard

Open the interactive visual dashboard for the current repo's graph.

## What it is

An interactive 2D graph viewer in the user's default browser. Shows:
- **Code layer** — gray circles, sized by node kind (Class/Function/File/etc.)
- **Feature layer** — blue rounded-rectangles (from `functionality.json`)
- **Task layer** — amber diamonds (from `tasks.json`)
- **Doc layer** — green hexagons (Document nodes)
- **Cross-layer edges** — dashed blue (curated, e.g. feature→file anchors) or dotted green (inferred, e.g. doc→code MENTIONS)
- **Code edges** — solid relation-colored (CALLS, REFERENCES, IMPORTS, etc.)

Filter panel (left side): toggle layers independently, toggle code node types.

## Steps

1. **Call the verb:**
   ```
   graph_dashboard()
   ```
   Returns `{url, port}` like `http://127.0.0.1:54321`.

2. **Tell the user the URL** and optionally what they'll see first:
   > Dashboard running at http://127.0.0.1:54321 — open it in your browser. You'll see all four layers (code/features/tasks/docs) with cross-layer edges. Toggle layers in the left panel.

3. **Let the dashboard run.** The server stays up until the user closes the session or kills the process. No further action from the agent.

## When to use which view

- **Understanding a new repo** — leave all layers on, zoom in on the highest-fan-in hub (biggest node)
- **Feature ownership mapping** — turn off code layer, show only features + tasks + their cross-layer edges
- **Impact analysis preview** — click a feature node; neighboring features + anchored files + related tasks light up
- **Documentation coverage check** — show only doc + code layers, see which files have MENTIONS edges (inferred doc coverage)

## View modes (top of filter panel, added 2026-04-27)

- **tree** (2D default) — directory-tree grouping. Files cluster under their parent dir; sibling dirs spread by leaf count. Best for "what's the shape of this repo" orientation.
- **layers** (3D default) — code/features/tasks/docs separated into stacked planes. Use this for cross-layer questions ("which features touch this subsystem").
- **community** — clusters by detected graph community. Useful when you want graph-derived groupings rather than directory-derived ones.
- **force** — unconstrained physics simulation. Slow on large graphs (>3000 nodes auto-falls back to grouped positioning).

3D mode is best for layer separation; 2D is best for tree orientation. The mode link in the sidebar header switches between them.

## Profile note

This verb is in the **full profile**. On lean profile installs (Codex/OpenCode default), the verb is hidden from `tools/list` but **still callable by name via `tools/call`**. If the user reports "tool not found," ensure you're calling it as `graph_dashboard`, not `/graph_dashboard`.

If the user is on lean and wants dashboard access surfaced, they can remove `--toolset=lean` from the MCP config args and restart.

## Prerequisites

- `.aify-graph/graph.sqlite` must exist (auto-built on first `graph_status()` call)
- `.aify-graph/functionality.json` optional — without it, feature/task layers simply don't appear
- `.aify-graph/tasks.json` optional — same, shows up when present

If the user says "the dashboard is empty of features/tasks", tell them to run `/graph-build-functionality` and/or `/graph-build-tasks` first.

## What NOT to do

- Don't keep calling `graph_dashboard()` if it's already returned a URL — subsequent calls will start another server on a different port. One is enough.
- Don't try to render the graph yourself. The dashboard server is the rendering path; the MCP verbs (`graph_pull`, `graph_path`, etc.) are the data path.
- Don't describe individual nodes in prose if you could just send the user to the dashboard. The dashboard exists precisely for visual exploration.
