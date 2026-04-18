---
name: graph-anchor-drift
description: Use when the user asks to "fix anchors", "update functionality.json after renames", "check for drift", or when brief.agent.md reports `features with stale anchors`. Inspects the current diff (or a specified git range) against `.aify-graph/functionality.json`, detects broken/renamed anchors, and proposes a patch. Never mutates silently — always shows the diff and waits for confirmation.
---

# graph-anchor-drift

You are detecting and repairing drift between the `functionality.json` overlay and the code. When code moves, gets renamed, or gets deleted, the feature anchors pointing at it become stale. This skill finds those cases and proposes a targeted patch — without rewriting features the user curated.

## When to run

Trigger conditions (any one is enough):
- `brief.agent.md` shows `TRUST weak: N features with stale anchors (...)`
- User just renamed symbols / moved files and knows the overlay may be out of date
- User explicitly asks to "audit" or "fix" the functionality map
- After merging a branch that touched anchored code

## Scope

- **In scope**: symbol-rename detection, file-move detection, file-delete detection, removed-symbol detection
- **In scope**: proposing additions when a new file obviously belongs to an existing feature (e.g. `app/Http/Controllers/NewThingController.php` when `Controllers/*` is already anchored there)
- **Out of scope**: creating entirely new features — that's the `graph-map-functionality` skill
- **Out of scope**: changing feature descriptions, labels, or tags

## Steps

### 1. Read current state

```bash
cat .aify-graph/functionality.json
cat .aify-graph/brief.json | jq '.features'
```

If `functionality.json` doesn't exist, tell the user to run `graph-map-functionality` first — nothing to drift from.

### 2. Decide the diff range

Ask the user, or default sensibly:
- **Uncommitted**: `git diff --name-status HEAD` + `git diff HEAD` (default if working tree is dirty)
- **Recent commits**: `git diff --name-status HEAD~N...HEAD` (user picks N)
- **Branch scope**: `git diff --name-status origin/main...HEAD`

### 3. Classify changes

For each affected file in the diff:
- **`D` (deleted)**: file removed. Any feature anchoring it needs the anchor removed.
- **`R` (renamed)**: `git` tells you old→new. Feature anchors pointing at the old path need to update to the new path.
- **`M` (modified)**: check for **symbol-level** changes — look for removed/renamed function/class definitions in the hunk headers (`git diff -U0 HEAD -- path/to/file.js | grep '^@@'` gives context) or inspect the hunks directly for `-function name(` / `+function newName(` patterns.
- **`A` (added)**: check if the new file obviously belongs to an existing feature whose `files` glob would match it (e.g. `app/Http/Middleware/NewThing.php` fits `app/Http/Middleware/*`).

### 4. Cross-reference against functionality.json

For each change event, walk the features array:
- **symbols[]**: if a removed/renamed symbol is in a feature's symbols list, flag it.
- **files[]**: if a deleted/renamed file matches a feature's file glob, flag it.
- **routes[]/docs[]**: skip for v1 unless user explicitly wants route/doc drift too — usually routes and docs don't churn in a single PR.

### 5. Build the proposed patch

For each flagged feature, emit a structured change:

```
Feature: auth
  Remove symbol anchor: authenticate   (deleted in 7a3b2c1)
  Rename symbol anchor: verify_token → verify_credentials   (renamed in 7a3b2c1)
  Remove file anchor: app/Http/Middleware/OldName.php   (renamed to NewName.php)
  Add file anchor: app/Http/Middleware/NewName.php   (new, matches existing glob family)
```

Bundle all changes per feature so user sees the net effect.

### 6. Preserve user-curated fields

NEVER touch: `id`, `label`, `description`, `tags`, `source`. If `source: "user"`, still propose anchor changes but flag extra-carefully: these are features the user explicitly touched. Default to keeping the user in the loop on those.

### 7. Show the user the patch

Format as a unified-diff-ish preview:

```diff
--- .aify-graph/functionality.json
+++ .aify-graph/functionality.json (proposed)
@@ feature "auth" @@
   anchors.symbols:
-    "authenticate"                 # removed: deleted in commit 7a3b2c1
-    "verify_token"                 # renamed → verify_credentials
+    "verify_credentials"
   anchors.files:
-    "app/Http/Middleware/OldName.php"
+    "app/Http/Middleware/NewName.php"
```

Summary line at the bottom:
```
3 features affected: auth, billing, search
5 anchor additions, 4 anchor removals, 2 renames
```

### 8. Apply only on explicit confirmation

Do not write the file without the user saying yes. If they say "apply", write the new `functionality.json`. If they want a subset, let them edit the proposal.

### 9. Regenerate the brief

After applying:
```bash
node scripts/graph-brief.mjs <repoRoot>
```

Verify the `TRUST` line no longer mentions stale anchors for the features you touched. If it still does, you missed something — report honestly and offer to iterate.

## Evidence rules (what to include in the proposal)

Every proposed change must be backed by a concrete diff line. Format:
- `# <what happened>: <commit or diff ref>`

Examples:
- `# removed: deleted in working tree (uncommitted)`
- `# renamed → newName: git status R100`
- `# file moved: git log --follow 7a3b2c1`

If you can't cite specific evidence, don't propose the change. Say so to the user.

## What NOT to do

- **Don't add anchors speculatively.** If a new file doesn't match any existing glob family, don't guess it into a feature. Leave it for `graph-map-functionality` to reclassify.
- **Don't remove `source: "user"` anchors** that the user manually added even if the graph can't see them — maybe the graph is stale, maybe the symbol is in a dynamically-loaded file. Flag it for user review, don't silently remove.
- **Don't rename features.** Anchor drift ≠ identity drift. The feature id/label stays even if every anchor moved.
- **Don't batch-apply without showing the diff.** The whole point of this skill is that the user stays in the loop.
- **Don't use this as a substitute for feature generation.** If the user has no `functionality.json` yet, run `graph-map-functionality` first.

## Example run

```
> /graph-anchor-drift

Reading .aify-graph/functionality.json (6 features)...
Checking git diff HEAD (working tree)...

Drift detected in 2 features:

Feature: brief-artifacts
  Removed symbol: classifyRole   (renamed → classifySymbolRole in HEAD diff)
  Propose: rename "classifyRole" → "classifySymbolRole"

Feature: query-verbs
  Removed file: mcp/stdio/query/verbs/old_verb.js (deleted uncommitted)
  Propose: remove "mcp/stdio/query/verbs/old_verb.js" from files[]
  Note: this feature still has 4 other valid anchors.

No other features affected.

Apply these 2 changes? (yes / edit / no)
```

Honest, narrow, reversible. That's the target.
