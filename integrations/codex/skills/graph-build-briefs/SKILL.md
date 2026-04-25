---
name: graph-build-briefs
description: "Use when the user wants to regenerate the brief files (`.aify-graph/brief.{md,agent.md,onboard.md,plan.md,json}`) and unresolved categorization WITHOUT re-indexing the code graph or proposing functionality changes. Common case: user hand-edited `functionality.json` or `tasks.json` and wants briefs to reflect the change. Also fine after a `graph_index(force=true)` when you want fresh briefs immediately."
---

# graph-build-briefs

Regenerate all five briefs and `.aify-graph/unresolved-categorization.json` from the existing code graph + overlay files. No re-indexing, no functionality proposal. Fast (2-5 seconds on most repos).

## When this skill is right

- User edited `.aify-graph/functionality.json` directly and wants the brief to pick up changes
- User edited `.aify-graph/tasks.json` (e.g. after running `/graph-build-tasks`) and wants the per-feature task lines in `brief.plan.md` updated
- User just ran `graph_index(force=true)` and wants briefs to match the fresh graph
- Anything where the code graph is already correct but the briefs need a refresh

## When to use a different skill

- `.aify-graph/` doesn't exist yet, or `graph.sqlite` is missing → `/graph-build-all`
- Code changed, index may be stale → `graph_index(force=true)` first, then this skill (or just `/graph-build-all`)
- Features are outdated after a refactor → `/graph-build-functionality` (proposes new content), then this skill

## Steps

### 1. Locate the aify-project-graph clone

Look at the MCP config entry for `aify-project-graph` — the `args` entry contains the absolute path to `mcp/stdio/server.js`. The clone root is that path minus `/mcp/stdio/server.js`.

If you cannot find it, ask the user for the install path.

### 2. Run the brief generator

```bash
node <CLONE_PATH>/scripts/graph-brief.mjs <TARGET_REPO>
```

Output should show five file sizes, one unresolved-category summary line, and `wrote to <TARGET_REPO>/.aify-graph/`. Typical size (post-2026-04-21 Phase 1+3): `brief.agent.md` 300-1100 tokens (TOOLING / COVERS / EXPORTS / INTERNAL_HUBS / PATHS sections — PATHS adds 200-400 tokens when EXPORTS resolve to traceable handlers); `brief.plan.md` 300-600 tokens when functionality.json is populated, ~70 tokens when empty. If `brief.agent.md` exceeds ~1200 tokens the repo likely has an unusually large public API surface (many MCP verbs or routes) — inspect EXPORTS + PATHS sections.

### 3. Sanity-check the result

Tell the user the new sizes and whether the plan brief picked up changes. Examples:

- "Regenerated briefs. `brief.plan.md` is now 558 tokens (was 310) — per-feature task lines from your tasks.json were added."
- "Regenerated briefs. `brief.plan.md` is 70 tokens — still empty because `functionality.json` has no features yet. Run `/graph-build-functionality` first."
- "Regenerated briefs. `TRUST` line changed from `ok` to `weak: 2 features with stale anchors (auth, billing)` — run `/graph-anchor-drift` to fix."

## What NOT to do

- Don't run `graph_index(force=true)` here — that's a different scope. If code is stale, tell the user to do it first.
- Don't edit `functionality.json` or `tasks.json` here — those are user-curated or skill-owned.
- Don't regenerate if the previous output already matches what the user wanted — the brief generator is content-hash-guarded and skips unchanged files, but running the command anyway is cheap noise.
