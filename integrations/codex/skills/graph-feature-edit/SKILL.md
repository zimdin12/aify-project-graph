---
name: graph-feature-edit
description: Use when the user wants to surgically add/edit/remove/link/unlink/rename/merge a single feature in `.aify-graph/functionality.json` — not a full refresh. Examples "add a feature for caching", "link auth depends_on sessions", "rename auth-old to authentication", "merge old-billing into billing". Validates anchors, shows a diff, confirms before writing, then rebuilds briefs as part of the same transaction.
trigger: tool_available("graph_status") OR tool_available("graph_pull") OR tool_available("graph_index")
---

# graph-feature-edit

Surgical mutation of `.aify-graph/functionality.json` — one feature at a time. For full-map proposal/refresh use `/graph-build-functionality`; for drift repair after code moves use `/graph-anchor-drift`.

## Sub-actions

```
/graph-feature-edit add <id> label="<label>" description="<desc>" \
                        symbols="a,b" files="src/x/*" routes="POST /x" \
                        depends_on="other-feature" tags="tag1,tag2"

/graph-feature-edit edit <id> [label=...] [description=...] [tags=...]
/graph-feature-edit link <id> symbols <sym1> <sym2>
/graph-feature-edit link <id> files <glob>
/graph-feature-edit link <id> routes <route>
/graph-feature-edit link <id> docs <path>
/graph-feature-edit link <id> depends_on <other-feature>
/graph-feature-edit link <id> related_to <other-feature>
/graph-feature-edit unlink <id> <bucket> <value>
/graph-feature-edit rename <old-id> to <new-id>
/graph-feature-edit merge <source-id> into <target-id>
/graph-feature-edit remove <id>
```

## Transaction shape (every action follows this)

1. **Parse intent.** Identify action + target + payload.
2. **Load** `.aify-graph/functionality.json` and `.aify-graph/brief.json`.
3. **Validate** (asymmetric per action — see below).
4. **Compute patch.** Produce the exact before/after JSON for the feature(s) touched.
5. **Show diff** to the user. Explicit unified-diff-like preview.
6. **Wait for confirmation.** For `remove` and `merge`, require explicit yes.
7. **Write** `functionality.json`.
8. **Rebuild briefs.** Run `node <CLONE_PATH>/scripts/graph-brief.mjs <REPO_ROOT>` as an explicit final step — not silent. Report new brief sizes + any new TRUST warnings.
9. **Summary:** "wrote feature X; brief.plan.md regenerated, N features valid, M stale."

## Validation rules (dev-specified asymmetry)

**For add / edit / link / merge:**
- Every new `symbols[]` entry should resolve in the graph — run a `graph_lookup` equivalent. Surface unresolved symbols as warnings (not blockers) with a suggestion: "symbol X doesn't resolve yet — confirm or drop it."
- Every new `files[]` glob should match at least one File/Directory node. Same warn-not-block.
- Every `depends_on` / `related_to` target must be an existing feature id. Blocking error if not.
- Warn if the new feature has zero anchors across all buckets — low-coverage features rot fast.

**For rename:**
- `<old-id>` must exist.
- `<new-id>` must not exist.
- Update every `depends_on` / `related_to` reference in other features + every `features: []` reference in `tasks.json`.

**For merge:**
- Both ids must exist.
- Target (`<target-id>`) wins for label, description, tags.
- Source's anchors are UNION'd into target (dedupe).
- Source's `depends_on` / `related_to` are UNION'd into target, minus self-references.
- Every `depends_on` / `related_to` pointing at source gets rewritten to target.
- Every `tasks.json` task's `features: []` pointing at source gets rewritten.
- Source feature is deleted.

**For remove:**
- Warn if any task references this feature (show ids).
- Warn if any other feature depends_on / related_to this one.
- Always require explicit confirmation before write.
- Do NOT silently remove task refs — tell the user the orphaned tasks exist post-delete so they can run `/graph-task-edit unlink` if they want.

**For unlink:**
- Remove the value from the specified bucket.
- If the bucket ends up empty, **delete the container** (drop `anchors.files: []` rather than keep it). Exception: `anchors.symbols / files / routes / docs` are always present in the schema, so keep them as `[]` only if the schema requires it — check current schema before pruning.

## Provenance

On any write:
- If the feature had `source: "user"`, keep it.
- If it was `source: "llm"` and the user manually edited via this skill, upgrade to `source: "user"` (human touched it = human-owned now).
- Preserve `tags` and any unknown fields as-is — don't strip things the user added manually.

## What NOT to do

- Don't batch multiple unrelated edits into one invocation without showing each. The skill is surgical; use it per-change or run it multiple times.
- Don't skip the rebuild-briefs step. The whole point of editing is the new state shows up in briefs.
- Don't auto-fix `depends_on` cycles without asking. If `A depends_on B` and `B depends_on A` after a merge, surface the cycle — let the user decide.
- Don't write if validation had any blocking error. Warnings OK; errors stop.
- Don't guess symbol anchors. If the user said `symbols="doStuff"` and `doStuff` isn't in the graph, warn them — don't silently drop.

## Example run

```
> /graph-feature-edit link auth depends_on sessions

- loading .aify-graph/functionality.json
- feature "auth" exists ✓
- feature "sessions" exists ✓
- not already linked ✓

proposed patch:
  feature "auth":
    depends_on: ["storage"] → ["storage", "sessions"]

apply? (yes / no / edit)
> yes

- wrote functionality.json
- ran graph-brief.mjs
  brief.plan.md: 558 → 571 bytes (+13)
  brief.json: features.valid includes "auth" with deps=[storage,sessions]
  no new trust warnings

done.
```
