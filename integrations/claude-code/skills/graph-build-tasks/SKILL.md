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

## Output

Write normalized tasks with:
- `id`, `title`, `status`, `url`, `assignee`, `updated_at`
- `features`
- `files_hint`
- `evidence`

Keep unattributed tasks too — `features: []` is better than silent drop.

## Do not

- assume a specific task tracker
- mutate `functionality.json`
- fetch huge backlogs; stick to open / in-progress / recently updated work
- poll continuously; this is snapshot sync, not a daemon
