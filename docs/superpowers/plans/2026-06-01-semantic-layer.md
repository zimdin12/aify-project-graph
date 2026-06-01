# Semantic Layer Implementation Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`. Three phases, each independently shippable.

**Goal:** Add archetype cluster-naming, a guided `graph_tour`, and opt-in semantic search — composing into one agent-facing semantic layer.

**Spec:** `docs/superpowers/specs/2026-06-01-semantic-layer-design.md`

---

## PHASE A — Archetypes

### Task A1: `classifyArchetype` (pure heuristic)

**Files:** Create `mcp/stdio/intelligence/archetypes.js`; Test `tests/unit/intelligence/archetypes.test.js`

- [ ] Test (RED): a cluster of `{label:'GravityBody',file_path:'sim/fields/Gravity.cpp'}` + fluid/mass → `Physics`; `{label:'Renderer',file_path:'engine/render/Render.cpp'}` + shader → `Rendering`; empty/ambiguous → `confidence:'low'` / id `mixed`.

```javascript
// tests/unit/intelligence/archetypes.test.js
import { describe, it, expect } from 'vitest';
import { classifyArchetype, ARCHETYPES } from '../../../mcp/stdio/intelligence/archetypes.js';
describe('classifyArchetype', () => {
  it('names a physics cluster', () => {
    const r = classifyArchetype([
      { label: 'GravityBody', file_path: 'sim/fields/Gravity.cpp' },
      { label: 'apply_gravity', file_path: 'sim/fields/Gravity.cpp' },
      { label: 'FluidCell', file_path: 'sim/fields/Fluid.cpp' },
    ]);
    expect(r.id).toBe('physics');
    expect(r.confidence).not.toBe('low');
  });
  it('names a rendering cluster', () => {
    const r = classifyArchetype([
      { label: 'Renderer', file_path: 'engine/render/Render.cpp' },
      { label: 'draw_quads', file_path: 'engine/render/Render.cpp' },
      { label: 'ShaderProgram', file_path: 'engine/render/Shader.cpp' },
    ]);
    expect(r.id).toBe('rendering');
  });
  it('returns low-confidence mixed when nothing matches', () => {
    const r = classifyArchetype([{ label: 'Xyzzy', file_path: 'foo/bar.cpp' }]);
    expect(r.confidence).toBe('low');
  });
  it('exposes a non-empty archetype table', () => { expect(ARCHETYPES.length).toBeGreaterThan(10); });
});
```

- [ ] Implement `archetypes.js`: `ARCHETYPES` table (id,name,keywords[]) for rendering, physics, simulation, audio, input, ai, networking, assets, ecs, math, ui, serialization, scripting, shaders, memory, concurrency, core, tooling, tests. `classifyArchetype(samples)`:
  - lowercase each sample's label + path segments; for each archetype, `score += 2` per path-segment keyword hit, `+1` per label keyword hit; track top + runner-up.
  - `confidence`: `high` if top ≥ 3 and top ≥ 2×runner-up; `medium` if top ≥ 2; else `low`. When `low`, return `{ id:'mixed', name:'Mixed', score:top, confidence:'low' }`.
- [ ] Run green. Commit `feat(intel): archetype heuristic classifier`.

### Task A2: wire archetypes into `computeOverview`

**Files:** Modify `mcp/stdio/intelligence/analytics.js` (`computeOverview`); Test `tests/unit/intelligence/archetype-overview.test.js`

- [ ] Test (RED): build a seeded graph with a physics-ish cluster; `computeOverview(db)` clusters carry `.archetype` and the physics cluster's `label` reflects it; an architecture-overlay layer name still wins when passed.
- [ ] Implement: where `computeOverview` finalizes each cluster, collect a sample of its members (`top_symbols` already computed + their file_paths, plus a few raw member rows), call `classifyArchetype`, set `cluster.archetype = { id, name, confidence }`; if `confidence !== 'low'` AND no architecture-overlay label was used, set `cluster.label = name` (append ` · <existing dir/label>` when it adds signal). Additive — keep `cluster.cluster` key + counts unchanged.
- [ ] Run green + run existing analytics tests (no regression). Commit `feat(intel): archetype names in computeOverview (overview/digest/dashboard)`.

---

## PHASE B — Guided tour

### Task B1: `graph_tour` verb

**Files:** Create `mcp/stdio/query/verbs/tour.js`; register in `mcp/stdio/server.js`; Test `tests/unit/query/tour.test.js`

- [ ] Test (RED): seeded multi-archetype graph → `graphTour({repoRoot})` returns markdown containing an ordered list (`1.`…), an entrypoints step first, an archetype name from Phase A, and a `graph_packet` suggestion; `steps:3` caps to 3 region steps; `focus:'physics'` narrows.
- [ ] Implement `tour.js` `graphTour({repoRoot, steps=8, focus=null})`:
  - read freshness gate (reuse `inspectReadFreshness`), open db.
  - gather: entrypoints (brief.json `entrypoints` or Entrypoint nodes), `computeOverview` clusters (with archetypes), `computeHotspots`.
  - assemble ordered steps: [entrypoints] + topN archetype regions (rank by node_count×inter-cluster degree, filtered by `focus`) + hotspots-in-top-regions + cross-archetype flows. Cap total to `steps`.
  - render compact markdown: framing header + numbered steps, each `**N. <title>** — <why>` then key symbols (`label @ file:line`) + `→ <suggested_verb>`.
  - graceful: empty graph → a clear "graph not built / empty" line.
- [ ] Register `graph_tour` in server.js tool list (callable; NOT in DEFAULT_TOOL_NAMES — long-tail like graph_onboard). Add one ORIENT-FIRST line in `server-instructions.js`.
- [ ] Run green (+ server-toolset test still passes — graph_tour is full-listed, not default). Commit `feat(verb): graph_tour ordered orientation sequence`.

---

## PHASE C — Semantic search (opt-in, pluggable)

### Task C1: similarity primitives

**Files:** Create `mcp/stdio/intelligence/embeddings.js`; Test `tests/unit/intelligence/embeddings.test.js`

- [ ] Test (RED): `cosineSimilarity([1,0],[1,0])===1`; `cosineSimilarity([1,0],[0,1])===0`; `rankBySimilarity([1,0], [{id:'a',vec:[1,0]},{id:'b',vec:[0,1]}], 2)` → `a` first. `embedderFromEnv()` returns null when `APG_EMBED_ENDPOINT` unset.
- [ ] Implement `embeddings.js`: `cosineSimilarity(a,b)`, `rankBySimilarity(q, items, k)` (items `{id,vec,...}` → sorted by similarity desc, top-k, attach `similarity`), `embedderFromEnv()` (returns `null` if no `APG_EMBED_ENDPOINT`, else an async `embedTexts(texts)` POSTing OpenAI-compatible `/v1/embeddings`), `composeSemanticText(node, overlay)`.
- [ ] Run green. Commit `feat(intel): embedding similarity primitives + env embedder`.

### Task C2: build + query

**Files:** `mcp/stdio/intelligence/embeddings.js` (`buildEmbeddings`); modify `mcp/stdio/query/verbs/search.js` (`mode`); Test `tests/unit/query/semantic-search.test.js`

- [ ] Test (RED) with a FAKE embedder (text→deterministic small vector, e.g. bag-of-chars buckets): `buildEmbeddings({db,repoRoot,embedder:fake})` writes `embeddings.json`; `graphSearch({repoRoot, query:'gravity force', mode:'semantic', embedder:fake})` ranks the gravity symbol first. With no embeddings file → result includes a lexical fallback + a hint string.
- [ ] Implement `buildEmbeddings({db, repoRoot, embedder, overlay})`: select first-party non-container symbols, `composeSemanticText`, batch-embed, write `.aify-graph/embeddings.json` `{model,dim,built_at,vectors:[{id,label,file_path,vec}]}`.
- [ ] Implement `graphSearch` `mode` param: `'semantic'` → load embeddings.json; if missing/null embedder → run lexical + prepend hint `(semantic search needs embeddings — run /graph-build-embeddings)`; else embed query (via injected/env embedder), `rankBySimilarity`, render top-k with `similarity`. `embedder` is an injectable param defaulting to `embedderFromEnv()`.
- [ ] Run green. Commit `feat(search): opt-in semantic mode (pluggable embeddings, lexical fallback)`.

### Task C3: build flow + docs

- [ ] Create `scripts/build-embeddings.mjs` (CLI: `node scripts/build-embeddings.mjs <repoRoot>` → openExistingDb + overlay + `embedderFromEnv()` → `buildEmbeddings`; clear message if no embedder configured).
- [ ] Add a short "Semantic layer" section to `docs/code-intel-v2-status.md` (archetypes, graph_tour, semantic search + APG_EMBED_* config).
- [ ] Full suite `npx vitest run` green. Commit `docs+scripts: semantic layer build flow + status`.

---

## Self-review
- Spec A→Tasks A1-A2; B→B1; C→C1-C3; #4 overlay consumed in A2/B1/C2. ✓
- No placeholders (archetype scoring + fake embedder are concretely specified).
- Type consistency: `classifyArchetype`→`{id,name,score,confidence}` used in A2/B1; `rankBySimilarity` items `{id,vec}` consistent C1/C2; `embedTexts(texts)` signature consistent.
- Deferred: bundled local model; tour dashboard rendering.
