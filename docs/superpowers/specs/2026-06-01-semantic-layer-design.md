# Semantic Layer — Archetypes + Tour + Semantic Search — design spec

_Date: 2026-06-01 · Branch: `plan/next-gen-code-intel-bridge` · Author: this project_

## Goal

Add a holistic "semantic / meaning" layer on top of the structural graph, borrowing the highest-value agent-facing ideas the reference sweep surfaced, integrated so they compose rather than bolt on:

- **A — Archetypes:** name code clusters by purpose ("Rendering Pipeline", "Physics") instead of "cluster N". (graphify)
- **B — Guided tour:** an ordered "explore this codebase in N steps" sequence. (understand-anything)
- **C — Semantic search:** find code by meaning, not just lexical match. (understand-anything embeddings)
- **#4 Semantic enrichment + layers** already exist as the optional `graph-build-intelligence` overlay (`semantic.files.json` + `architecture.json`); A/B/C CONSUME it when present and degrade gracefully when absent.

Design principles (per the agent-front-door doctrine): every piece is **agent-consumable**, **graceful-degrade** (works structure-only, richer with the overlay), and **fits the existing surfaces** rather than adding parallel ones.

## Context (verified)

- `mcp/stdio/intelligence/analytics.js` `computeOverview(db, {topSymbols, architecture})` clusters by `community_id` → architecture layer → directory, producing `{cluster, label, node_count, top_symbols, edges_to}`. The community `label` is generic today. **Archetypes plug in here** → improves `graph_overview`, `graph_digest`, and the dashboard `/api/overview` (the "by community" Map) in one place.
- `mcp/stdio/query/verbs/onboard.js` (`graph_onboard`) exists — orientation, but not an ordered step sequence.
- `mcp/stdio/query/verbs/search.js` `graphSearch({repoRoot, query, type, file, kind, limit, fresh})` — lexical/FTS. **Semantic mode plugs in here** (`mode` param).
- `mcp/stdio/intelligence/overlays.js` loads + validates the optional semantic/architecture overlays.

## Component A — Archetypes (heuristic, zero-dep)

**Module:** `mcp/stdio/intelligence/archetypes.js` (pure, no IO).

- A game-dev-tuned table `ARCHETYPES = [{ id, name, keywords[] }]` covering: Rendering, Physics, Simulation, Audio, Input, AI, Networking, Assets/Resources, ECS/Entities, Math, UI/HUD, Serialization, Scripting, Shaders, Memory, Concurrency, Core/Engine, Build/Tooling, Tests. Keywords match against lowercased symbol labels + file-path segments.
- `classifyArchetype(samples) -> { id, name, score, confidence }` where `samples` is an array of `{ label, file_path }` (a cluster's top members + files). Scores each archetype by keyword hits weighted (path hit > label hit); `confidence = 'high'|'medium'|'low'` by margin over runner-up; returns `null`-ish ("Mixed") when no archetype clears a floor.
- Pure + deterministic → unit-testable with fixture clusters. No LLM, no overlay required.

**Wire-in:** `computeOverview` accepts the cluster's member sample, calls `classifyArchetype`, and sets `cluster.archetype = { id, name, confidence }` and upgrades `cluster.label` to the archetype name when `confidence !== 'low'` (keeping the dir/symbol label as a suffix for disambiguation, e.g. `Physics · sim/fields`). Existing consumers unaffected (additive field); the dashboard `groupTitle`/overview labels and `graph_digest` automatically read better. When an architecture overlay is present, its layer name takes precedence over the heuristic (overlay = curated truth).

## Component B — Guided tour (`graph_tour`)

**Verb:** `mcp/stdio/query/verbs/tour.js` `graphTour({ repoRoot, steps = 8, focus = null })` → markdown (narrative verb).

- Builds an ordered orientation from existing signals (no new graph engine):
  1. **Entry points** (from `brief.json` entrypoints / Entrypoint nodes) — "where execution starts".
  2. **Major archetype regions** (from `computeOverview` + archetypes, ranked by node_count × inter-cluster degree) — "the big subsystems, by purpose".
  3. **Hotspots within the top regions** (from `computeHotspots`) — "the god-nodes you'll touch most".
  4. **Notable cross-archetype flows** (inter-cluster edges between different archetypes) — "how the subsystems talk".
- Each step: `{ n, title, why, archetype, key_symbols: [{label, file, line}], suggested_verb }` (e.g. "→ graph_packet Renderer to go deeper"). Rendered as compact markdown with a one-line framing header ("treat as an orientation map, then drill with graph_packet").
- `focus` narrows the tour to one archetype/subsystem. `steps` caps length (budgeted).
- Graceful: works on structure alone; uses semantic summaries when the overlay is present.
- **Registration:** callable verb (long-tail, like `graph_onboard` — not in the 16-verb default surface but invokable). Add to `server-instructions` ORIENT FIRST ("new repo? graph_tour for an ordered N-step walk").

## Component C — Semantic search (opt-in, pluggable embeddings)

**Embedder (injectable):** `mcp/stdio/intelligence/embeddings.js`
- `embedTexts(texts, opts)` calls an **OpenAI-compatible** `/v1/embeddings` endpoint configured by env: `APG_EMBED_ENDPOINT` (e.g. `http://localhost:11434/v1/embeddings` for Ollama, or OpenAI/Voyage), `APG_EMBED_MODEL`, `APG_EMBED_API_KEY` (optional for local). No bundled model — keeps the tool build-free; works with whatever the team already runs.
- `embedderFromEnv()` returns a configured embedder or `null` (unconfigured → graceful degrade). For tests, the embedder is a parameter (deterministic fake), so no network in CI.
- `cosineSimilarity(a, b)` + `rankBySimilarity(queryVec, items, k)` — pure, unit-tested.

**Build step:** `buildEmbeddings({ db, repoRoot, embedder })` → for each first-party symbol, compose `semanticText` = `label + kind + signature + file path + (overlay summary/tags if present)`, embed in batches, write `.aify-graph/embeddings.json` = `{ model, dim, built_at, vectors: [{ id, label, file_path, vec }] }`. Opt-in (costs compute/API) — exposed via a `/graph-build-embeddings` skill flow (sibling to `graph-build-intelligence`). Skipped automatically when no embedder configured.

**Query:** extend `graphSearch` with `mode` (`'lexical'` default | `'semantic'`).
- `mode:'semantic'`: load `embeddings.json`; if missing OR no embedder → **fall back to lexical + a one-line hint** ("semantic search needs embeddings — run /graph-build-embeddings with APG_EMBED_* configured"). Else embed the query, cosine-rank, return top-k with `similarity` scores, rendered like lexical results.
- No behavior change for default lexical callers.

## Architecture / isolation

- `archetypes.js`, `embeddings.js` (similarity + builder) are pure/injectable → unit-tested without IO/network.
- `computeOverview` gains one additive field; `graphSearch` one optional param; one new verb file `tour.js`. No new dispatch paths beyond registering `graph_tour`.
- Reuses `computeOverview`/`computeHotspots`, `overlays.js`, `brief.json`. The overlay stays the single semantic-truth source; archetypes are the always-on heuristic fallback.

## Testing

- `classifyArchetype`: fixture clusters (a `sim/fields/Fluid.cpp`+`gravity` cluster → Physics; `render/Shader.cpp` → Rendering; ambiguous → Mixed/low). Deterministic.
- `computeOverview`: a seeded graph's clusters carry `archetype`; label upgrades when confident; overlay layer name wins when present.
- `cosineSimilarity`/`rankBySimilarity`: known vectors → known order.
- `buildEmbeddings` + semantic `graphSearch` with a **fake embedder** (maps text→deterministic vector): a query close to symbol X ranks X first; missing embeddings → lexical fallback + hint.
- `graph_tour`: a seeded multi-archetype graph → ordered steps, entrypoints first, ≤ `steps`, each step has key_symbols + suggested_verb; `focus` narrows.
- Full suite stays green (currently 1066).

## Rollout / phasing

Build + commit in three phases (each independently valuable):
1. **Phase A — Archetypes** (zero-dep, immediate dashboard + overview + digest payoff).
2. **Phase B — Tour** (`graph_tour`, composes A).
3. **Phase C — Semantic search** (opt-in embeddings, injectable/fake-tested).

Additive + opt-out-safe throughout; semantic search is fully opt-in and degrades to lexical. Land on `plan/next-gen-code-intel-bridge`; commit, do not push unless asked. Deferred: a true bundled local embedding model (kept external/pluggable on purpose); dashboard rendering of the tour (verb-first; visual later).
