---
name: graph-build-all
description: Use when the user says "generate project graphs", "build graph for this repo", "rebuild everything", "index this repo from scratch", or opens a new repo that has no `.aify-graph/` directory yet. Runs the full build in one pass — graph index, all five briefs, and a proposed functionality.json. Partial-build skills exist for narrower jobs (see below).
trigger: tool_available("graph_status") OR tool_available("graph_pull") OR tool_available("graph_index")
---

# graph-build-all

Build (or rebuild) the complete graph + brief + overlay set for a repo in one go. This is the skill that answers "just get me set up" without six manual commands.

**When to use a narrower skill instead:**
- Just hand-edited `functionality.json`? → `/graph-build-briefs` (~2-3s)
- Want to refresh the feature map after a refactor? → `/graph-build-functionality` (~30-60s, LLM proposal + review)
- Sync open tasks from your tracker? → `/graph-build-tasks` (~10-60s depending on tracker)
- Source code changed, want fresh code graph only? → call `graph_index(force=true)` via MCP (~100ms-5s if incremental, 5s-3min if full rebuild)
- Feature anchors drifted after rename/move? → `/graph-anchor-drift` (~5-15s)

**Timing of this (`graph-build-all`):** 30-90s on first run for a typical repo. On subsequent runs, the code graph is incremental (~100ms if nothing changed, seconds if some files edited), brief generation is ~2-3s, functionality proposal is the bottleneck (~30-60s LLM pass).

## Steps

### 1. Build the code graph

If `.aify-graph/graph.sqlite` doesn't exist, trigger index. Easiest path:

```
graph_status()
```

This auto-indexes on first call. Takes 5-60 seconds depending on repo size. Confirm `indexed: true`.

If it errored with a `better-sqlite3` native-binary complaint, the MCP server's preflight should have auto-rebuilt it on startup — if you still see this error during a tool call, tell the user to run `npm rebuild better-sqlite3` in the aify-project-graph clone manually and stop here.

### 2. Generate the five briefs

Use the repo's own aify-project-graph clone (the path the user installed from):

```bash
node <AIFY_GRAPH_CLONE>/scripts/graph-brief.mjs <TARGET_REPO>
```

Should emit `brief.md`, `brief.agent.md`, `brief.onboard.md`, `brief.plan.md`, `brief.json` under `<TARGET_REPO>/.aify-graph/`.

If you don't know `<AIFY_GRAPH_CLONE>`, look at the MCP config for the `aify-project-graph` server — the `args` entry contains the path.

### 3. Propose the functionality overlay

Run the `graph-build-functionality` skill's logic inline: read `.aify-graph/brief.json`, draft a set of 5-10 features with `anchors.symbols` and `anchors.files` globs, show the user a diff, write `.aify-graph/functionality.json` on confirmation.

Keep the proposal small. 5-10 clear features beats 20 speculative ones. Preserve any existing entries.

### 4. Regenerate briefs with the overlay populated

```bash
node <AIFY_GRAPH_CLONE>/scripts/graph-brief.mjs <TARGET_REPO>
```

Now `brief.plan.md` has a FEATURES section with `open:` / `tests:` / `load:` per feature. This is what makes plan briefs worth using.

### 5. (Optional) Offer to sync tasks

If the user has a task tracker (ClickUp/Asana/Linear/Jira/GitHub) connected via MCP, offer to run `/graph-build-tasks` to add `tasks.json`. Skip if no task source is detected — this is optional enrichment.

### 6. Done — tell the user how to use it

Short summary:
- "Paste `.aify-graph/brief.agent.md` into session prompts for orient-shaped work."
- "Paste `.aify-graph/brief.plan.md` before change-planning."
- "Use `graph_pull(node='...')` for cross-layer context on a specific file, feature, symbol, or task."
- "Run `/graph-build-all` again whenever the repo changes significantly or you want to refresh the overlay."

## What NOT to do

- Don't create functionality.json entries without anchoring each to something that actually exists in the graph.
- Don't skip step 4 — the plan brief is useless without the overlay populated.
- Don't run graph index in parallel with brief generation (they share a file lock).
- Don't invent tasks.json entries — only use a real task source.
