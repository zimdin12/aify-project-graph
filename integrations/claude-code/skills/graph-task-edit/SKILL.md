---
name: graph-task-edit
description: Use when the user wants to surgically add/edit/remove/link/unlink/rename a single task in `.aify-graph/tasks.json` — not a full sync from a tracker. Examples "add a local task for refactor", "link CU-123 to feature auth", "remove T-local-42", "edit CU-200 status=done". Validates feature references, shows a diff, confirms before writing, then rebuilds briefs as part of the same transaction.
---

# graph-task-edit

Surgical mutation of `.aify-graph/tasks.json`. For full refresh/sync from external trackers use `/graph-build-tasks`.

## Sub-actions

```
/graph-task-edit add <id> title="<title>" features="auth,billing" \
                       status=open assignee=steven files_hint="src/auth.php"

/graph-task-edit edit <id> [title=...] [status=...] [assignee=...] [url=...]
/graph-task-edit link <id> feature <feature-id>
/graph-task-edit link <id> file <path>
/graph-task-edit unlink <id> feature <feature-id>
/graph-task-edit unlink <id> file <path>
/graph-task-edit rename <old-id> to <new-id>
/graph-task-edit remove <id>
```

## Transaction shape (every action)

1. **Parse intent.** Action + target id + payload.
2. **Load** `.aify-graph/tasks.json` and `.aify-graph/functionality.json` (for cross-validation).
3. **Validate** per action rules below.
4. **Compute patch.** Exact before/after JSON for the task(s) touched.
5. **Show diff** to the user.
6. **Wait for confirmation.** Always for `remove`.
7. **Write** `tasks.json`.
8. **Rebuild briefs.** Run `node <CLONE_PATH>/scripts/graph-brief.mjs <REPO_ROOT>` as an explicit final step. Report new `brief.plan.md` size + OPEN_TASKS section changes.
9. **Summary:** "wrote task X; brief.plan.md OPEN_TASKS now shows N tasks for feature Y."

## Validation rules (asymmetric — tasks are looser than features)

**For add / edit / link:**
- Any referenced `features[]` entries must exist in `functionality.json`. Blocking error on unknown feature id.
- `files_hint[]` entries — no hard requirement (tasks may reference files that don't exist yet, e.g. planning work). Warn only.
- Task id uniqueness — blocking error if adding an id that already exists. Use `/graph-task-edit edit` or `rename` to modify.
- `status` should be one of: `open`, `in_progress`, `blocked`, `review`, `done`, `closed`. Warn-only if outside.

**For remove:**
- Warn (don't block) if the task has non-trivial content (features + files_hint populated) — user may want to keep the record.
- Always require explicit confirmation.

**For unlink:**
- Remove from the specified bucket.
- If `features: []` or `files_hint: []` becomes empty, **delete the field** (don't keep as `[]`). Same cleanup rule as features skill.

**For rename:**
- `<old-id>` must exist.
- `<new-id>` must not exist.
- If commits reference the old id in their messages, warn the user that git history still contains the old id — rename is in the overlay, not in git.

**Local tasks vs external tasks:**
- Task ids like `T-local-*` / `TODO-*` / `PLAN-*` are assumed local — user-authored, not backed by a tracker. Allow freely.
- Task ids matching tracker patterns (`CU-*` ClickUp, `ENG-*` Linear, `#1234` GitHub, etc.) are assumed external — editing status/assignee locally will DIVERGE from the tracker. Warn when editing these: "this looks like an external task; your edit won't sync back to [tracker]."

## Provenance

- If the task has `source: "user"` (local task), keep it.
- If it was written by `/graph-build-tasks` with `source: "clickup"` (or other adapter), and the user edits via this skill, preserve the source but add `locally_edited: true` so future syncs can detect divergence.

## What NOT to do

- Don't silently regenerate `tasks.json` from tracker on edit — that's what `/graph-build-tasks` is for.
- Don't batch unrelated task edits. One action per invocation keeps diffs small.
- Don't skip rebuild-briefs. OPEN_TASKS in brief.plan.md only reflects the change after regen.
- Don't over-validate `files_hint` — tasks can plan for files that don't exist yet (new feature work).
- Don't auto-create features referenced by a task. If user links to unknown feature, error + tell them to run `/graph-feature-edit add` first.

## Example run

```
> /graph-task-edit add T-local-1 title="refactor middleware" features=auth status=open

- loading tasks.json (14 tasks) + functionality.json
- feature "auth" exists ✓
- id "T-local-1" is free ✓
- status "open" valid ✓

proposed patch:
  tasks.json:
    + {
    +   "id": "T-local-1",
    +   "title": "refactor middleware",
    +   "status": "open",
    +   "features": ["auth"],
    +   "source": "user"
    + }

apply? (yes / no / edit)
> yes

- wrote tasks.json (15 tasks)
- ran graph-brief.mjs
  brief.plan.md: 571 → 584 bytes
  OPEN_TASKS section: auth now shows 2 (CU-42, T-local-1)

done.
```
