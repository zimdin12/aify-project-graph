---
name: graph-map-tasks
description: Use when the user asks to "import tasks", "map tasks", "sync tasks", or "show what tasks are in flight" against the repo's feature map. Works with any task source — ClickUp, Asana, Linear, Jira, GitHub Issues, or a plaintext file — via whatever task-management MCP is available or by reading user-supplied text. Attributes each task to features in `.aify-graph/functionality.json` and writes a per-feature summary.
---

# graph-map-tasks

You are helping the user link their external task/issue tracker to the code graph. The goal: for any open task, the agent can see what features/files it's likely to touch; for any file/feature, the agent can see which tasks are currently in motion around it.

This skill is **source-agnostic**. It does not assume ClickUp or any specific tracker. It adapts to whatever task-management tools Claude Code has access to, or falls back to reading tasks from a user-supplied file.

## Detection order (which source to use)

Check which task sources are available in this environment and ask the user which to use if multiple. Common MCPs that expose tasks:

- **ClickUp MCP** — tools like `clickup_filter_tasks`, `clickup_search`, `clickup_get_task`
- **Asana MCP** — `search_tasks`, `get_my_tasks`, `get_tasks`, `get_project`
- **Linear MCP** — typically `list_issues`, `get_issue` (check the prefix)
- **Jira MCP** — `search_issues`, `get_issue`
- **GitHub MCP** — `list_issues`, `search_issues`
- **Plaintext** — user points you at a file with one task per block (see format below)

If no task MCP is connected and no plaintext file is offered, ask the user:
  1. Which tracker do you use?
  2. Would you prefer to paste tasks into a file instead?

Don't default to one — let the user choose.

## What you produce

**Primary output:** `.aify-graph/tasks.json` — machine-readable mapping of tasks to features and files.

```json
{
  "version": "0.1",
  "source": "clickup|asana|linear|jira|github|plaintext",
  "fetched_at": "2026-04-19T12:00:00Z",
  "tasks": [
    {
      "id": "CU-abc123",
      "title": "Fix auth token expiry on refresh",
      "status": "in_progress",
      "url": "https://app.clickup.com/t/abc123",
      "assignee": "alice",
      "updated_at": "2026-04-18",
      "features": ["auth"],
      "files_hint": ["app/Http/Middleware/RequireToken.php"],
      "evidence": "title mentions 'auth token'; 3 recent commits referencing CU-abc123 touched auth/"
    }
  ]
}
```

**Secondary output** (optional, if user wants it): an update to `.aify-graph/brief.plan.md`'s RECENT section or a new section listing in-flight tasks by feature.

## Steps

1. **Preconditions:**
   - Check `.aify-graph/functionality.json` exists. If not, run or suggest the `graph-map-functionality` skill first.
   - Read `.aify-graph/functionality.json` to learn feature ids + anchors.
   - Read `.aify-graph/brief.json` for symbol/file context.

2. **Detect source:** enumerate available task MCPs (grep tool list for `clickup|asana|linear|jira|github_issues|issue` patterns). If multiple, ask user. If none, offer plaintext flow.

3. **Fetch tasks:**
   - Scope: open / in-progress / recently-updated tasks only (last 30 days by default unless user says otherwise)
   - Cap at ~50 tasks to keep the mapping tractable
   - Normalize every task to the shape above (id, title, status, url, assignee, updated_at)

4. **Attribute tasks to features** using these signals in order of strength:
   1. **Explicit tags/custom-fields** on the task (e.g. ClickUp tag `feature:auth` → `features: ["auth"]`)
   2. **Commit message references** — grep git log for the task id (`git log --grep=CU-abc123 --name-only`). If commits exist, the files they touch map to features via `featuresForFile()` logic from the overlay loader
   3. **Branch name match** — if the task id appears in any branch, check which files that branch touched
   4. **Title/description keyword match** against feature labels/descriptions (fuzzy). This is the weakest signal — flag it in the `evidence` field
   5. **File path mentions** in the task description (e.g. "update app/Http/Middleware/RequireToken.php") → direct match

5. **Include evidence** for every attribution. The user needs to be able to verify why task X was mapped to feature Y. "Title fuzzy-match only" is an honest evidence string — don't hide weakness.

6. **Surface unattributed tasks:** if a task has no matching feature, put it in the output anyway with `features: []` and `evidence: "no feature match found"`. Don't drop data silently.

7. **Write `tasks.json`.**

8. **Offer to regenerate briefs** so the task map shows up in `brief.plan.md`:
   - Currently brief.plan.md has a RECENT (feature-tagged) section from git log.
   - Brief generator can be extended to also read `tasks.json` and add an OPEN_TASKS section. If that extension exists (check `mcp/stdio/brief/generator.js`), suggest regeneration. If not, tell the user the tasks.json is the canonical artifact and brief integration is Horizon B work.

## Plaintext fallback format

If the user has no task MCP connected, offer this format for them to paste into `tasks.txt`:

```
## TASK-001
title: Fix auth token expiry on refresh
status: in_progress
assignee: alice
updated: 2026-04-18
url: https://example.com/t/001
description: |
  The /refresh endpoint re-issues a token but doesn't reset the expiry
  clock on the old token. Need to invalidate the old one in the session
  table.

## TASK-002
title: Add rate limiter to /public/search
...
```

Parse on blank-line-separated blocks. Same attribution logic applies.

## What NOT to do

- **Don't assume ClickUp** or any specific tracker. The moment your prompt says "ClickUp task" without checking, you've scope-creeped.
- **Don't batch all 500 tasks** from a workspace. Stick to open/in-progress/recently-updated and cap at ~50. More is noise.
- **Don't guess feature attribution.** If the signal is weak, say so in `evidence`. Fuzzy-title-match is honest, claiming certainty is not.
- **Don't mutate `functionality.json`** here. This skill attributes tasks to existing features; it doesn't invent new ones. If the user needs new features, that's the `graph-map-functionality` skill.
- **Don't poll continuously.** This is a one-shot or on-demand snapshot. Background sync is Horizon B/C.

## Example run (ClickUp available)

```
> /graph-map-tasks

[agent detects clickup MCP is connected]
[agent reads .aify-graph/functionality.json — 5 features: auth, billing, search, admin, reports]
[agent calls clickup_filter_tasks(statuses=["open","in progress"], updated_since="30d")]
[agent iterates 23 tasks, calls clickup_get_task for each to get tags+description]
[agent greps git log for each task id, finds 14 with commit history]
[agent writes .aify-graph/tasks.json with 23 entries, 18 attributed to features, 5 unattributed]

23 tasks imported (ClickUp). 18 mapped to features:
  auth: 7 tasks
  billing: 5 tasks
  search: 3 tasks
  admin: 2 tasks
  reports: 1 task
  (unattributed: 5)

Wrote .aify-graph/tasks.json.
```

## Refresh frequency

- Daily is probably enough for most workflows
- On-demand when the user asks "what's in flight around X?"
- Not a background daemon — agent-triggered only for this skill
