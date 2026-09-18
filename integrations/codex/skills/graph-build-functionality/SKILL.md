---
name: graph-build-functionality
description: Use when the user wants to build or refresh the feature/functionality map for the repo. Produces or updates `.aify-graph/functionality.json` from the graph, docs, directory structure, and commit vocabulary. Preserve user edits and always show a diff before writing. Typical runtime ~30-60s (LLM proposal + user review). For full rebuild including code+briefs, use `/graph-build-all`.
---

# What is this repo FOR? — the layer the code cannot answer

The graph knows every function and every call. It does not know that eleven of them are "checkout"
and that checkout is the thing that must not break. Nobody can derive that from the code, because it
is a claim about intent.

★ THIS FILE IS THE ONLY PLACE THAT CLAIM LIVES, and its entire value is that a HUMAN decided what
is in it. That is also its whole fragility: an invented feature is indistinguishable from a curated
one the moment it is written, and every consumer downstream treats both as somebody's decision.

So propose, show, and let the user cut. Refine what is there rather than replacing it — an existing
entry is user truth, however thin it looks.

**When this is not the job:**

- **one feature changed** → `/graph-feature-edit`. A full refresh to add one entry rewrites
  decisions nobody asked you to revisit
- **the code moved and the map did not** → `/graph-anchor-drift`. That is repair against a diff,
  and it has an evidence standard this does not

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
- optional `tests` when one shared or monolithic test file covers the feature better than inference will
- optional `depends_on` / `related_to` when architecture docs make those links clear
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
- Anchor each feature to the few symbols that carry its behaviour, and list the literal file each one lives in.
  Only literal files and the symbols in them are watched for change (see Confirm); a glob such as `src/auth/*`
  still attributes files to the feature but is never watched.
- Only include routes/docs if the repo clearly has them.
- On repos with one shared test entrypoint, prefer explicit feature-level `tests[]` over pretending there is no test anchor.
- Add `depends_on` when one feature cannot work without another; add `related_to` for softer cross-links.
- If the repo is dirty, bias enrichment toward the currently edited seam: read `graph_health()` / `brief.plan.md` for `DIRTY:` / `DIRTY SEAMS:` and make sure those features have explicit `tests[]`, `anchors.docs`, and relationship links before inventing new features elsewhere.
- On large repos, treat overlay richness as part of "done", not polish: a skeletal file/symbol map is not enough if the brief still shows `tests 0/N`, `docs 0/N`, `deps 0/N`, or `related 0/N` for the active seams.
- Validate anchors before proposing them: symbol exists, file glob matches real files.
- Show the diff first. Write only after explicit confirmation.

## Confirm, so the map can say when it may be wrong

After the user accepts a feature, and after you have read its anchored code and checked each claim in its
description, stamp it:

    apg features confirm <id>... --by <your-agent-id>      # or --all

That records who vouched and a hash of each anchored symbol and file. From then on `graph_health` and the
feature's `graph_packet` name every anchored symbol that changed since (`CHANGED SINCE — re-check the
description: changed src/auth.js#login`). The ping is a fact about the code, not a verdict: re-read the
changed code, fix the description if it is wrong, then confirm again to clear it. `apg features status` lists
every feature's state and what it cannot watch.

Never confirm a feature you did not check against the code: the stamp is the claim "someone looked".

Measured before this shipped (docs/evidence/feature-map-pings-2026-09-18/RESULTS-4.md): on a very active repo,
the pings caught 8 of 9 features that really went stale, and about a third of features needed a re-check
each week.

## Do not

- invent features with no code anchors
- silently overwrite user-curated entries
- guess symbols you cannot verify
- turn this into a full repo audit; it is a draft map, not documentation
