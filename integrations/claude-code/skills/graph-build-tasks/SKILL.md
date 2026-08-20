---
name: graph-build-tasks
description: Use when the user wants to import or sync tasks into `.aify-graph/tasks.json`. Source-agnostic — ClickUp, Asana, Linear, Jira, GitHub Issues, or plaintext. Maps tasks to existing features and keeps evidence for every attribution. Typical runtime ~10-60s depending on tracker API speed + task count.
---

# Is anything already in flight on this?

Someone is about to change a feature. The question they cannot answer from the code is whether
somebody else is already working on it — that lives in a tracker, and the tracker does not know
about files.

This joins the two, so "what is in flight on checkout" becomes answerable.

⛔ AND THE ANSWER IS ONLY AS COMPLETE AS THE SYNC. `tasks.json` answers by listing what is
RECORDED, so an unsynced tracker produces "nothing in flight" — which is a clean, confident, wrong
answer, and indistinguishable from a genuinely quiet feature. Say when the sync last ran; it is the
difference between an absence and an ignorance.

**When this is not the job:** one task changed → `/graph-task-edit`. A full sync to fix one status
is a job you will repeat tomorrow.

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
