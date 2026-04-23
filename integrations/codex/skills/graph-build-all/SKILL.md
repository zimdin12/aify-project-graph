---
name: graph-build-all
description: Use when the user says "generate project graphs", "build graph for this repo", "rebuild everything", "index this repo from scratch", or opens a new repo that has no `.aify-graph/` directory yet. Runs the full build in one pass — graph index, all five briefs, and a proposed functionality.json. Partial-build skills exist for narrower jobs (see below).
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

### 2.5. Fix repo hygiene before the graph drifts

- ensure `<TARGET_REPO>/.gitignore` contains:
  - `.aify-graph/`
- if the repo has local build or scratch trees that should never be indexed, add them to `<TARGET_REPO>/.aifyignore`
  - examples: `build-linux-techlead`, `scratch`, `tmp-local`
- only use `.aifyinclude` when a default-ignored dir really contains source code

Do not confuse these:
- `.gitignore` keeps derived graph artifacts out of git
- `.aifyignore` keeps extra scratch dirs out of the graph
- `.aifyinclude` opts a default-ignored dir back into the graph

### 3. Propose the functionality overlay

Run the `graph-build-functionality` skill's logic inline: read `.aify-graph/brief.json`, draft a set of 5-10 features with `anchors.symbols` and `anchors.files` globs, and fill the overlay fields that make the map actually useful on large repos:
- `tests[]`
- `anchors.docs`
- `depends_on`
- `related_to`

Show the user a diff, write `.aify-graph/functionality.json` on confirmation.

Keep the proposal small. 5-10 clear features beats 20 speculative ones. Preserve any existing entries. Do not stop at a skeletal file/symbol map if the active seams still have no tests/docs/relationships.

### 4. Regenerate briefs with the overlay populated

```bash
node <AIFY_GRAPH_CLONE>/scripts/graph-brief.mjs <TARGET_REPO>
```

Now `brief.plan.md` has a FEATURES section with `open:` / `tests:` / `load:` per feature. This is what makes plan briefs worth using.

### 5. Auto-offer `/graph-build-tasks` when a tracker MCP is present

Running `/graph-build-tasks` is the unlock that turns the graph from a static map into a daily-use tool: it activates per-feature open-task lines in `brief.plan.md`, makes `/graph-walk-bugs` usable, cross-validates feature↔task bindings, and populates the dashboard's task layer.

Task sync is not just about coverage. Ask the writer to preserve attribution quality:
- `link_strength: strong|mixed|broad`
- auditable `evidence` prefixes like `tag:`, `commit:`, `branch:`, `path:`, `title:`, `spec:`

That lets the briefs distinguish hard code-anchored tasks from broad/spec planning links.

Check for a tracker MCP in the active session (names matching `clickup`, `asana`, `linear`, `jira`, or `github`). If one is connected:

> "I can sync your tracker's open tasks into `.aify-graph/tasks.json` now so the plan brief shows per-feature open work. Run `/graph-build-tasks`? (takes 10-60s)"

Proceed on confirmation. Skip silently if no tracker MCP is detected — this stays optional.

### 6. Done — tell the user how to use it

Short summary:
- "Paste `.aify-graph/brief.agent.md` into session prompts for orient-shaped work."
- "Paste `.aify-graph/brief.plan.md` before change-planning."
- "Use `graph_pull(node='...')` for cross-layer context on a specific file, feature, symbol, or task."
- "If `brief.plan.md` still says the overlay is thin, enrich `tests[]`, `anchors.docs`, `depends_on`, `related_to`, and task-link evidence before expecting the map to dominate."
- "Run `/graph-build-all` again whenever the repo changes significantly or you want to refresh the overlay."

## What NOT to do

- Don't create functionality.json entries without anchoring each to something that actually exists in the graph.
- Don't skip step 4 — the plan brief is useless without the overlay populated.
- Don't run graph index in parallel with brief generation (they share a file lock).
- Don't invent tasks.json entries — only use a real task source.
