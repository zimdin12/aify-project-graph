---
name: graph-build-tasks
description: Use when the user wants to import or sync tasks into `.aify-graph/tasks.json`. Source-agnostic — ClickUp, Asana, Linear, Jira, GitHub Issues, or plaintext. Maps tasks to existing features and keeps evidence for every attribution. Typical runtime ~10-60s depending on tracker API speed + task count.
---

# graph-build-tasks

Link external tasks to the repo’s feature map and write `.aify-graph/tasks.json`.

## Preconditions

- `.aify-graph/functionality.json` should exist first
- read `.aify-graph/functionality.json` and `.aify-graph/brief.json` before mapping

## Source order

Use whatever task source is available:
- ClickUp / Asana / Linear / Jira / GitHub Issues
- plaintext file fallback if no task MCP is connected

If multiple sources are available, ask the user which one to use.

## Mapping signals, strongest first

1. explicit task tags / custom fields
2. commit-message references to the task id
3. branch-name references to the task id
4. file paths mentioned in the task
5. fuzzy title/description match to feature names

Every attribution must carry evidence. Weak evidence is okay; hidden guesswork is not.

When you write `evidence`, prefer machine-readable prefixes:
- `tag:physics`
- `commit:CU-123 touched engine/voxel/ChunkManager.cpp`
- `branch:feature/CU-123-gravity`
- `path:engine/rendering/RayTracingPipeline.cpp`
- `title:variable gravity touches planet-body-systems`
- `spec:future networking work spans sim-coordinator + replication`

Also write `link_strength`:
- `strong` — direct code/tracker binding (`tag:`, `commit:`, `branch:`, `path:`)
- `mixed` — several weaker but consistent signals
- `broad` — future/spec/title-only mapping that improves coverage but is not code-anchored

Prefer explicit `broad` over pretending a speculative link is hard evidence.

## Output

Write normalized tasks with:
- `id`, `title`, `status`, `url`, `assignee`, `updated_at`
- `features`
- `files_hint`
- `evidence`
- `link_strength`

Keep unattributed tasks too — `features: []` is better than silent drop.

## Do not

- assume a specific task tracker
- mutate `functionality.json`
- fetch huge backlogs; stick to open / in-progress / recently updated work
- poll continuously; this is snapshot sync, not a daemon
