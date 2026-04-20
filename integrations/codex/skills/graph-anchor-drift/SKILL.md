---
name: graph-anchor-drift
description: Use when feature anchors may be stale after renames, moves, or deletes. Compares the current diff (or chosen git range) against `.aify-graph/functionality.json`, proposes targeted anchor fixes, and never writes without confirmation.
trigger: tool_available("graph_status") OR tool_available("graph_pull") OR tool_available("graph_index")
---

# graph-anchor-drift

Repair drift between code and `.aify-graph/functionality.json` without rewriting the feature map.

## Run when

- the brief trust line mentions stale anchors
- files or symbols were renamed / moved / deleted
- the user asks to audit or fix feature anchors

## What to inspect

- `.aify-graph/functionality.json`
- `.aify-graph/brief.json` trust/features block
- current diff or a user-specified git range

## What to fix

- renamed symbols in `anchors.symbols`
- moved / deleted files in `anchors.files`
- obvious new files that clearly belong to an existing glob family

## Rules

- preserve feature identity (`id`, `label`, `description`, `tags`, `source`)
- do not invent whole new features here
- do not silently remove user-added anchors when evidence is weak
- show the proposed diff first, then wait for confirmation
- regenerate briefs after applying so trust is re-evaluated

## Evidence standard

Every proposed change should be backed by a concrete diff fact:
- deleted file
- rename pair
- removed/renamed symbol
- new file matching an existing feature family

If you cannot cite evidence, do not propose the change.
