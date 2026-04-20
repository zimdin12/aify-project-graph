---
name: graph-build-functionality
description: Use when the user wants to build or refresh the feature/functionality map for the repo. Produces or updates `.aify-graph/functionality.json` from the graph, docs, directory structure, and commit vocabulary. Preserve user edits and always show a diff before writing. Typical runtime ~30-60s (LLM proposal + user review). For full rebuild including code+briefs, use `/graph-build-all`.
trigger: tool_available("graph_status") OR tool_available("graph_pull") OR tool_available("graph_index")
---

# graph-build-functionality

Create or refresh `.aify-graph/functionality.json`, the human-curated feature map for the repo.

## Inputs, in order

1. Existing `.aify-graph/functionality.json` — user truth; refine, don’t replace
2. Architecture docs first: `docs/architecture/*`, `docs/contracts/*`, then root `*.md` matching `/architecture|overview|design/i`
3. Repo structure: package/module boundaries, clustered subdirs, framework folders
4. `.aify-graph/brief.json` — subsystems, hubs, entrypoints
5. Recent commit vocabulary (`git log --oneline -30`)

## What to produce

Small set of real features, each with:
- stable `id`
- short `label`
- one-sentence `description`
- a few `anchors` (`symbols`, `files`, optional `routes`, optional `docs`)
- `source: "llm"` on new proposals

Prefer 5-10 clear features over 20 tiny ones.

## Working rules

- Pick one taxonomy axis for the project before drafting features and stick to it:
  - subsystem
  - user-capability
  - cross-cutting concern
  - layer
- Let docs lead when they are concrete; use hubs/entrypoints as a fallback, not the first source of truth.
- Prefer folder/package/module boundaries over symbol hubs when they better match the chosen taxonomy axis.
- Preserve existing ids, labels, descriptions, tags, and any `source: "user"` entries.
- Prefer globs for `anchors.files` instead of listing every file.
- Only include routes/docs if the repo clearly has them.
- Validate anchors before proposing them: symbol exists, file glob matches real files.
- Show the diff first. Write only after explicit confirmation.

## Do not

- invent features with no code anchors
- silently overwrite user-curated entries
- guess symbols you cannot verify
- turn this into a full repo audit; it is a draft map, not documentation
