// Shared analytics module (P2a / P2-9 — "end the dashboard-is-an-island").
//
// ONE place that computes the dashboard's analytic value:
//   - computeOverview     → community/layer/dir cluster map + inter-cluster edges
//   - computeHotspots     → god nodes (top-N by in+out degree)
//   - computeCycles       → file-level import/include cycles (bounded, dedup'd)
//   - computeProvenanceMix→ call-edge provenance split + shader-binding counts
//   - computeDigest       → token-budgeted TEXT summary composing all the above
//
// Pure functions over an OPEN graph db handle (the wrapped better-sqlite3 from
// storage/db.js — exposes .all/.get). They take a db, never open one, so BOTH
// the MCP verbs (now) and the dashboard endpoints (P2b) can call the exact same
// code and never drift. Community/centrality is REUSED from the persisted
// community_id (Leiden, analysis/communities.js) — no Leiden reimplementation.
//
// Cycle detection is the graphify find_import_cycles algorithm (MIT),
// reimplemented: collapse symbols to files, build a digraph from IMPORTS/
// include edges, enumerate bounded simple cycles via Tarjan SCC + bounded DFS,
// dedup rotations by normalizing to the lexicographically-smallest member,
// tightest-first, early-stop to avoid blowup.

import { classifyArchetype } from './archetypes.js';

// Symbol-ish node types — the things that carry real degree / are worth ranking
// as hotspots or clustering. Containers (File/Dir/Module/etc.) are excluded
// from hotspot ranking + cluster top-symbols, matching report.js/onboard.js.
const CONTAINER_TYPES = new Set([
  'Repository', 'File', 'Module', 'Directory', 'Document', 'Config', 'External',
]);

// Noise denylist for hotspots — reuses onboard.js HUB_NOISE wording so the two
// surfaces agree on what counts as a "boring" hub. Common stdlib/dunder names
// that rank high by degree but carry no architectural signal.
export const HOTSPOT_NOISE = new Set([
  'get', 'set', 'run', 'init', 'test', 'close', 'open', 'read', 'write',
  'json', 'print', 'log', 'parse', 'constructor', 'send', 'str', 'int',
  'len', '__init__', '__str__', '__repr__', 'toString',
]);

import { IMPORT_FAMILY, PROVENANCE_CALL_FAMILY } from '../storage/taxonomy.js';

// Relations that mean "A depends on / imports / includes B" at file level, for
// cycle detection. From the registry IMPORT_FAMILY minus LOADS_SHADER — cycle
// detection is a pure file-import/include graph and a shader load is not part
// of a file-level import cycle. (IMPORTS covers JS/TS/Python; INCLUDES the
// C/C++ #include file-edge.)
const IMPORT_RELATIONS = IMPORT_FAMILY.filter((r) => r !== 'LOADS_SHADER');

// Call-family relations whose provenance split is the trust signal.
const CALL_FAMILY_RELATIONS = PROVENANCE_CALL_FAMILY;

function communityIdExpr() {
  return `json_extract(n.extra, '$.community_id')`;
}

// ───────────────────────────────────────────────────────────────────────────
// computeOverview — cluster map.
//
// Clusters by community_id; falls back to architecture layer (if an
// architecture overlay is passed) and then to top-level directory. Each cluster
// gets a label, node_count, top_symbols (by degree), and aggregated
// inter-cluster edge counts.
// ───────────────────────────────────────────────────────────────────────────

function topLevelDir(filePath) {
  if (!filePath) return '(root)';
  const norm = String(filePath).replace(/\\/g, '/');
  const slash = norm.indexOf('/');
  return slash === -1 ? '(root)' : norm.slice(0, slash);
}

// Shared cluster-assignment policy: a node → {key,label} via the documented
// fallback chain (community_id → architecture layer → top-level directory).
// Factored out so computeOverview and computeBridges agree on cluster identity
// (one source of truth — they must, or bridges would point at clusters the
// overview never names). Returns the assignment fn plus the layer lookups the
// overview still needs for its dominant-layer relabeling.
function makeClusterOf(architecture = null) {
  const layerByPath = new Map();
  if (architecture?.assignments) {
    for (const [path, asg] of Object.entries(architecture.assignments)) {
      if (asg?.layerId) layerByPath.set(path, asg.layerId);
    }
  }
  const layerName = new Map();
  if (architecture?.layers) {
    for (const l of architecture.layers) layerName.set(l.id, l.name || l.id);
  }
  const clusterOf = (n) => {
    if (n.community_id != null && n.community_id !== '') {
      return { key: `c:${n.community_id}`, label: `community ${n.community_id}` };
    }
    const normPath = n.file_path ? String(n.file_path).replace(/\\/g, '/') : '';
    if (layerByPath.has(normPath)) {
      const lid = layerByPath.get(normPath);
      return { key: `l:${lid}`, label: layerName.get(lid) || lid };
    }
    const dir = topLevelDir(n.file_path);
    return { key: `d:${dir}`, label: dir };
  };
  return { clusterOf, layerByPath, layerName };
}

export function computeOverview(db, { topSymbols = 5, architecture = null } = {}) {
  // Pull every non-container node with its community_id + file_path. We assign
  // each node to a cluster key with the documented fallback chain.
  const nodes = db.all(`
    SELECT n.id, n.label, n.type, n.file_path,
           ${communityIdExpr()} AS community_id
    FROM nodes n
  `);

  const { clusterOf, layerByPath, layerName } = makeClusterOf(architecture);

  // node id → cluster key, and per-cluster accumulator.
  const nodeCluster = new Map();
  const clusters = new Map();
  for (const n of nodes) {
    const { key, label } = clusterOf(n);
    nodeCluster.set(n.id, key);
    if (!clusters.has(key)) {
      clusters.set(key, { cluster: key, label, node_count: 0, _symbols: [] });
    }
    const c = clusters.get(key);
    c.node_count += 1;
    if (!CONTAINER_TYPES.has(n.type)) {
      c._symbols.push({ id: n.id, label: n.label, type: n.type, file_path: n.file_path });
    }
  }

  // Degree (in+out) per node id, for ranking each cluster's top symbols.
  const degree = degreeMap(db);

  // Aggregate inter-cluster edge counts. Self-edges (same cluster) are skipped.
  const interEdges = new Map(); // `${from}=>${to}` → count
  const edges = db.all('SELECT from_id, to_id FROM edges');
  for (const e of edges) {
    const a = nodeCluster.get(e.from_id);
    const b = nodeCluster.get(e.to_id);
    if (!a || !b || a === b) continue;
    const k = `${a}=>${b}`;
    interEdges.set(k, (interEdges.get(k) || 0) + 1);
  }
  const edgesByCluster = new Map();
  for (const [k, count] of interEdges) {
    const [from, to] = k.split('=>');
    if (!edgesByCluster.has(from)) edgesByCluster.set(from, []);
    edgesByCluster.get(from).push({ cluster: to, count });
  }

  const out = [];
  for (const [key, c] of clusters) {
    const top = c._symbols
      .map((s) => ({ ...s, degree: degree.get(s.id) || 0 }))
      .sort((a, b) => b.degree - a.degree || (a.label || '').localeCompare(b.label || ''))
      .slice(0, topSymbols)
      .map(({ label, type, degree }) => ({ label, type, degree }));
    const edgesTo = (edgesByCluster.get(key) || [])
      .sort((a, b) => b.count - a.count);
    // Cluster naming. The archetype field is attached everywhere (additive). For
    // the LABEL of a generic community cluster (key `c:`): OVERLAY = TRUTH — if a
    // curated architecture overlay assigns this cluster's members to a dominant
    // layer, that curated name wins; otherwise fall back to the heuristic
    // archetype name (when confident). Native layer clusters (`l:`) and directory
    // clusters (`d:`) keep their own labels untouched.
    const archetype = classifyArchetype(c._symbols.slice(0, 16));
    let label = c.label;
    if (key.startsWith('c:')) {
      let overlayLayer = null;
      if (layerByPath.size) {
        const counts = new Map();
        for (const s of c._symbols) {
          const lid = layerByPath.get(String(s.file_path || '').replace(/\\/g, '/'));
          if (lid) counts.set(lid, (counts.get(lid) || 0) + 1);
        }
        let best = null; let bestN = 0;
        for (const [lid, n] of counts) if (n > bestN) { best = lid; bestN = n; }
        if (best) overlayLayer = layerName.get(best) || best;
      }
      if (overlayLayer) label = overlayLayer;
      else if (archetype.confidence !== 'low') label = archetype.name;
    }
    out.push({
      cluster: key,
      label,
      node_count: c.node_count,
      top_symbols: top,
      edges_to: edgesTo,
      archetype,
    });
  }
  // Largest clusters first — the legible front door.
  out.sort((a, b) => b.node_count - a.node_count || a.cluster.localeCompare(b.cluster));
  return out;
}

// in+out degree per node id. One pass over edges each direction.
function degreeMap(db) {
  const degree = new Map();
  const rows = db.all(`
    SELECT id, deg FROM (
      SELECT from_id AS id, COUNT(*) AS deg FROM edges GROUP BY from_id
      UNION ALL
      SELECT to_id AS id, COUNT(*) AS deg FROM edges GROUP BY to_id
    )
  `);
  for (const r of rows) degree.set(r.id, (degree.get(r.id) || 0) + r.deg);
  return degree;
}

// ───────────────────────────────────────────────────────────────────────────
// computeHotspots — god nodes (top-N by in+out degree).
// ───────────────────────────────────────────────────────────────────────────

export function computeHotspots(db, { limit = 15 } = {}) {
  // Degree = incoming + outgoing edges. We restrict to symbol-ish node types
  // and drop the noise denylist. Pull a generous candidate window then filter.
  const rows = db.all(`
    SELECT n.id, n.label, n.type, n.file_path,
           (SELECT COUNT(*) FROM edges e WHERE e.to_id = n.id)   AS fan_in,
           (SELECT COUNT(*) FROM edges e WHERE e.from_id = n.id) AS fan_out
    FROM nodes n
    WHERE n.type NOT IN ('Repository','File','Module','Directory','Document','Config','External')
    ORDER BY (fan_in + fan_out) DESC, n.label
    LIMIT $window
  `, { window: Math.max(limit * 4, 60) });

  const hotspots = [];
  for (const r of rows) {
    if (HOTSPOT_NOISE.has(r.label)) continue;
    hotspots.push({
      id: r.id,
      label: r.label,
      type: r.type,
      file_path: r.file_path,
      fan_in: r.fan_in,
      fan_out: r.fan_out,
      degree: r.fan_in + r.fan_out,
    });
    if (hotspots.length >= limit) break;
  }
  return hotspots;
}

// ───────────────────────────────────────────────────────────────────────────
// computeBridges — betweenness-ranked community bridges (borrow: graphify
// report.py bridge ranking + hub-exclusion).
//
// The naive "heaviest single inter-cluster edge per cluster" can't tell a
// structural cut-point from two big clusters that merely happen to share many
// edges. Instead we build the cluster META-GRAPH (clusters = nodes, inter-
// cluster edge counts = weights) and rank its edges by EDGE BETWEENNESS — how
// many shortest cluster-to-cluster paths cross each one. A high-betweenness
// meta-edge is a true bridge: cutting it fragments the architecture.
//
// HUB EXCLUSION: god-object nodes (top-degree hotspots) touch everything, so
// their edges make every cluster look coupled to every other and drown the real
// bridges. We drop edges incident to the hub set BEFORE aggregating, so the
// ranking reflects genuine structural coupling (graphify excludes hubs before
// community/bridge analysis). The meta-graph is small (number of clusters), so
// exact Brandes betweenness is cheap.
// ───────────────────────────────────────────────────────────────────────────
export function computeBridges(db, { architecture = null, excludeNodeIds = null, topN = 5 } = {}) {
  const { clusterOf } = makeClusterOf(architecture);
  const rows = db.all(`
    SELECT n.id, n.file_path, ${communityIdExpr()} AS community_id
    FROM nodes n
  `);
  const nodeCluster = new Map();
  const labelByKey = new Map();
  for (const n of rows) {
    const { key, label } = clusterOf(n);
    nodeCluster.set(n.id, key);
    if (!labelByKey.has(key)) labelByKey.set(key, label);
  }
  const hub = excludeNodeIds instanceof Set ? excludeNodeIds : new Set(excludeNodeIds || []);

  // Undirected inter-cluster weights; hub-incident edges dropped.
  const weight = new Map(); // `a|b` (a<b) → count
  for (const e of db.all('SELECT from_id, to_id FROM edges')) {
    if (hub.has(e.from_id) || hub.has(e.to_id)) continue;
    const a = nodeCluster.get(e.from_id), b = nodeCluster.get(e.to_id);
    if (!a || !b || a === b) continue;
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    weight.set(k, (weight.get(k) || 0) + 1);
  }
  if (!weight.size) return [];

  // Adjacency for the meta-graph.
  const adj = new Map();
  const addAdj = (x, y) => { if (!adj.has(x)) adj.set(x, new Set()); adj.get(x).add(y); };
  for (const k of weight.keys()) { const [a, b] = k.split('|'); addAdj(a, b); addAdj(b, a); }

  const between = brandesEdgeBetweenness(adj);
  return [...weight.entries()]
    .map(([k, count]) => {
      const [a, b] = k.split('|');
      return {
        fromKey: a, toKey: b,
        from: labelByKey.get(a) || a, to: labelByKey.get(b) || b,
        count, betweenness: between.get(k) || 0,
      };
    })
    .sort((x, y) => y.betweenness - x.betweenness || y.count - x.count)
    .slice(0, topN);
}

// Brandes edge-betweenness on an unweighted undirected graph given as an
// adjacency Map(node → Set(neighbors)). Returns Map(`a|b` with a<b → score).
// Standard Brandes accumulation; each undirected edge is summed from both
// endpoints so we halve at the end.
function brandesEdgeBetweenness(adj) {
  const nodes = [...adj.keys()];
  const ekey = (u, v) => (u < v ? `${u}|${v}` : `${v}|${u}`);
  const eb = new Map();
  for (const s of nodes) {
    const stack = [];
    const pred = new Map(nodes.map((n) => [n, []]));
    const sigma = new Map(nodes.map((n) => [n, 0])); sigma.set(s, 1);
    const dist = new Map(nodes.map((n) => [n, -1])); dist.set(s, 0);
    const queue = [s];
    let qi = 0;
    while (qi < queue.length) {
      const v = queue[qi++];
      stack.push(v);
      for (const w of adj.get(v) || []) {
        if (dist.get(w) < 0) { dist.set(w, dist.get(v) + 1); queue.push(w); }
        if (dist.get(w) === dist.get(v) + 1) { sigma.set(w, sigma.get(w) + sigma.get(v)); pred.get(w).push(v); }
      }
    }
    const delta = new Map(nodes.map((n) => [n, 0]));
    while (stack.length) {
      const w = stack.pop();
      for (const v of pred.get(w)) {
        const c = (sigma.get(v) / sigma.get(w)) * (1 + delta.get(w));
        const k = ekey(v, w);
        eb.set(k, (eb.get(k) || 0) + c);
        delta.set(v, delta.get(v) + c);
      }
    }
  }
  for (const k of eb.keys()) eb.set(k, eb.get(k) / 2);
  return eb;
}

// ───────────────────────────────────────────────────────────────────────────
// computeIsolated — the under-connected tail (knowledge gaps).
// Borrow: graphify report.py isolated-nodes. Symbol-ish nodes with in+out
// degree <= 1 — likely missing edges, undocumented, or dead. Complements
// computeHotspots (over-connected). Rows ascending by degree; stop once past 1.
// ───────────────────────────────────────────────────────────────────────────
export function computeIsolated(db, { limit = 12 } = {}) {
  const rows = db.all(`
    SELECT n.id, n.label, n.type, n.file_path,
           (SELECT COUNT(*) FROM edges e WHERE e.to_id = n.id)   AS fan_in,
           (SELECT COUNT(*) FROM edges e WHERE e.from_id = n.id) AS fan_out
    FROM nodes n
    WHERE n.type NOT IN ('Repository','File','Module','Directory','Document','Config','External')
    ORDER BY (fan_in + fan_out) ASC, n.label
    LIMIT $window
  `, { window: Math.max(limit * 3, 40) });
  const out = [];
  for (const r of rows) {
    const degree = r.fan_in + r.fan_out;
    if (degree > 1) break; // ascending — past the isolated tail
    if (HOTSPOT_NOISE.has(r.label)) continue;
    out.push({ label: r.label, type: r.type, file_path: r.file_path, degree });
    if (out.length >= limit) break;
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// computeCycles — file-level import/include cycles.
//
// graphify find_import_cycles, reimplemented (MIT). Collapse symbol nodes to
// file level via file_path, build a digraph from IMPORTS/INCLUDES edges, find
// bounded simple cycles (Tarjan SCC then bounded DFS enumeration), dedup
// rotations (normalize each cycle to start at its lexicographically-smallest
// member), tightest-first, early-stop at topN*10 to avoid blowup.
// ───────────────────────────────────────────────────────────────────────────

export function computeCycles(db, { maxLen = 5, topN = 20 } = {}) {
  // Build file→file adjacency from import/include edges. We resolve each edge
  // endpoint to its owning file via the node's file_path; edges whose endpoints
  // live in the same file are skipped (a file importing itself is not a cycle).
  const placeholders = IMPORT_RELATIONS.map((_, i) => `$r${i}`).join(',');
  const params = {};
  IMPORT_RELATIONS.forEach((rel, i) => { params[`r${i}`] = rel; });
  const edges = db.all(`
    SELECT nf.file_path AS from_file, nt.file_path AS to_file
    FROM edges e
    JOIN nodes nf ON nf.id = e.from_id
    JOIN nodes nt ON nt.id = e.to_id
    WHERE e.relation IN (${placeholders})
  `, params);

  const adj = new Map(); // file → Set<file>
  for (const e of edges) {
    const a = normFile(e.from_file);
    const b = normFile(e.to_file);
    if (!a || !b || a === b) continue;
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a).add(b);
  }

  if (adj.size === 0) return { cycles: [], capped: false, scanned: 0 };

  // Tarjan SCC — only nodes inside a non-trivial SCC can be on a cycle, so we
  // restrict the (expensive) DFS enumeration to each SCC independently.
  const sccs = tarjanSCC(adj).filter((c) => c.length > 1);

  const cap = Math.max(1, topN) * 10; // early-stop ceiling (blowup guard)
  const seen = new Set();             // normalized-rotation keys
  const cycles = [];
  let capped = false;

  outer:
  for (const scc of sccs) {
    const sccSet = new Set(scc);
    // Restrict adjacency to within-SCC edges for this enumeration pass.
    const localAdj = new Map();
    for (const u of scc) {
      const outs = [...(adj.get(u) || [])].filter((v) => sccSet.has(v));
      localAdj.set(u, outs);
    }
    // Bounded DFS from each node; only start cycles at nodes >= the start to
    // avoid re-finding rotations (classic Johnson-style start pruning).
    const ordered = [...scc].sort();
    for (const start of ordered) {
      const stack = [start];
      const onStack = new Set([start]);
      if (!dfsCycles(start, start, localAdj, stack, onStack, maxLen, seen, cycles)) {
        capped = true;
        break outer;
      }
      if (cycles.length >= cap) { capped = true; break outer; }
    }
  }

  // Tightest-first (shortest cycles), then lexicographic for stability.
  cycles.sort((a, b) => a.length - b.length || a.join('|').localeCompare(b.join('|')));
  const trimmed = cycles.slice(0, topN);
  if (cycles.length > topN) capped = capped || false; // trimming is not "capped"; capped means search stopped early
  return { cycles: trimmed, capped, scanned: adj.size };
}

function normFile(p) {
  if (!p) return '';
  return String(p).replace(/\\/g, '/');
}

// Bounded DFS that enumerates simple cycles returning to `start`. Records each
// found cycle (normalized to its lexicographically-smallest rotation) into
// `cycles`, deduping via `seen`. Returns false if the global cap is hit so the
// caller can stop early (blowup guard).
function dfsCycles(start, node, adj, stack, onStack, maxLen, seen, cycles) {
  if (cycles.length >= 10000) return false; // hard safety ceiling
  for (const next of (adj.get(node) || [])) {
    if (next === start && stack.length >= 2) {
      const norm = normalizeRotation(stack);
      const key = norm.join('|');
      if (!seen.has(key)) {
        seen.add(key);
        cycles.push(norm);
      }
      continue;
    }
    if (onStack.has(next)) continue;             // already on this path
    if (next < start) continue;                  // start-pruning for rotations
    if (stack.length >= maxLen) continue;        // length bound
    stack.push(next);
    onStack.add(next);
    if (!dfsCycles(start, next, adj, stack, onStack, maxLen, seen, cycles)) {
      stack.pop();
      onStack.delete(next);
      return false;
    }
    stack.pop();
    onStack.delete(next);
  }
  return true;
}

// Normalize a cycle to start at its lexicographically-smallest member so that
// A→B→C and B→C→A and C→A→B all collapse to one representative.
export function normalizeRotation(cycle) {
  let minIdx = 0;
  for (let i = 1; i < cycle.length; i++) {
    if (cycle[i] < cycle[minIdx]) minIdx = i;
  }
  return [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)];
}

// Iterative Tarjan strongly-connected-components over a Map<node, Set<node>>.
// Iterative (explicit stack) to survive deep graphs without blowing the JS
// call stack on big repos.
function tarjanSCC(adj) {
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const result = [];
  let counter = 0;

  const nodes = new Set(adj.keys());
  for (const outs of adj.values()) for (const v of outs) nodes.add(v);

  for (const root of nodes) {
    if (index.has(root)) continue;
    // Each work item: { node, iterator over neighbors, started }
    const work = [{ node: root, neighbors: [...(adj.get(root) || [])], i: 0 }];
    index.set(root, counter); low.set(root, counter); counter++;
    stack.push(root); onStack.add(root);

    while (work.length) {
      const frame = work[work.length - 1];
      const { node, neighbors } = frame;
      if (frame.i < neighbors.length) {
        const next = neighbors[frame.i++];
        if (!index.has(next)) {
          index.set(next, counter); low.set(next, counter); counter++;
          stack.push(next); onStack.add(next);
          work.push({ node: next, neighbors: [...(adj.get(next) || [])], i: 0 });
        } else if (onStack.has(next)) {
          low.set(node, Math.min(low.get(node), index.get(next)));
        }
      } else {
        // Done with this node — if it's a root of an SCC, pop the component.
        if (low.get(node) === index.get(node)) {
          const comp = [];
          let w;
          do {
            w = stack.pop();
            onStack.delete(w);
            comp.push(w);
          } while (w !== node);
          result.push(comp);
        }
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1].node;
          low.set(parent, Math.min(low.get(parent), low.get(node)));
        }
      }
    }
  }
  return result;
}

// ───────────────────────────────────────────────────────────────────────────
// computeProvenanceMix — call-family edge provenance split + shader counts.
// ───────────────────────────────────────────────────────────────────────────

export function computeProvenanceMix(db) {
  const callPlaceholders = CALL_FAMILY_RELATIONS.map((_, i) => `$c${i}`).join(',');
  const params = {};
  CALL_FAMILY_RELATIONS.forEach((rel, i) => { params[`c${i}`] = rel; });

  const rows = db.all(`
    SELECT provenance, COUNT(*) AS c
    FROM edges
    WHERE relation IN (${callPlaceholders})
    GROUP BY provenance
  `, params);

  const byProvenance = {};
  let total = 0;
  for (const r of rows) {
    byProvenance[r.provenance || 'EXTRACTED'] = r.c;
    total += r.c;
  }
  const pct = (n) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);
  const percentages = {};
  for (const [k, v] of Object.entries(byProvenance)) percentages[k] = pct(v);

  // Shader bridge counts — present only on C++ repos with the L5 bridge.
  // Count scope: ONLY language='glsl' ShaderBinding nodes are real descriptor-
  // set bindings. The cpp descriptor-write stash node (shader_bindings.js pass 2)
  // also carries type='ShaderBinding' but language='cpp' and would otherwise
  // inflate the GLSL binding total (review R2). Scope the count to glsl.
  const shaderBindings = countGlslShaderBindings(db);
  const loadsShader = countRelation(db, 'LOADS_SHADER');
  const declaresBinding = countRelation(db, 'DECLARES_BINDING');
  const overriddenBy = countRelation(db, 'OVERRIDDEN_BY');
  const lspVerified = byProvenance.LSP_VERIFIED || 0;

  return {
    total_call_edges: total,
    by_provenance: byProvenance,
    percentages,
    lsp_verified_pct: pct(lspVerified),
    shader: {
      bindings: shaderBindings,
      loads_shader: loadsShader,
      declares_binding: declaresBinding,
    },
    overridden_by: overriddenBy,
  };
}

function countNodeType(db, type) {
  try { return db.get('SELECT COUNT(*) AS c FROM nodes WHERE type = $t', { t: type }).c; }
  catch { return 0; }
}
// GLSL descriptor-set bindings only — excludes the language='cpp' descriptor-
// write stash node that also reuses type='ShaderBinding'.
function countGlslShaderBindings(db) {
  try {
    return db.get(
      "SELECT COUNT(*) AS c FROM nodes WHERE type = 'ShaderBinding' AND language = 'glsl'",
    ).c;
  } catch { return 0; }
}
function countRelation(db, relation) {
  try { return db.get('SELECT COUNT(*) AS c FROM edges WHERE relation = $r', { r: relation }).c; }
  catch { return 0; }
}

// ───────────────────────────────────────────────────────────────────────────
// computeDigest — token-budgeted TEXT summary composing all of the above.
//
// Modeled on graphify _subgraph_to_text: degree-sorted content, a hard char
// budget, and an explicit truncation note. This is THE artifact an agent calls
// to get the dashboard's whole analytic value in ~1–2k tokens.
// ───────────────────────────────────────────────────────────────────────────

export function computeDigest(db, { budget = 6000, architecture = null } = {}) {
  // budget is a CHAR budget (≈ budget/4 tokens). Default 6000 chars ≈ 1.5k tokens.
  const charBudget = Math.max(800, budget);

  const totalNodes = db.get('SELECT COUNT(*) AS c FROM nodes').c;
  const totalEdges = db.get('SELECT COUNT(*) AS c FROM edges').c;
  const totalFiles = db.get("SELECT COUNT(*) AS c FROM nodes WHERE type = 'File'").c;
  const communities = db.get(
    `SELECT COUNT(DISTINCT json_extract(extra, '$.community_id')) AS c
     FROM nodes WHERE json_extract(extra, '$.community_id') IS NOT NULL`
  ).c;

  const overview = computeOverview(db, { topSymbols: 3, architecture });
  const hotspots = computeHotspots(db, { limit: 10 });
  const prov = computeProvenanceMix(db);
  const { cycles, capped } = computeCycles(db, { maxLen: 5, topN: 8 });

  const layerCount = architecture?.layers?.length ?? 0;

  // Build sections as ordered blocks. Earlier blocks are higher priority and
  // survive truncation; later blocks are dropped first (graphify ordering).
  const blocks = [];

  blocks.push([
    `DIGEST ${totalFiles} files, ${totalNodes} nodes, ${totalEdges} edges, ${communities} communities`
    + (layerCount ? `, ${layerCount} layers` : ''),
  ]);

  if (layerCount) {
    const layerLine = architecture.layers
      .map((l) => l.name || l.id)
      .slice(0, 12)
      .join(' · ');
    blocks.push([`LAYERS ${layerLine}`]);
  } else if (overview.length) {
    const clusterLine = overview
      .slice(0, 8)
      .map((c) => `${c.label}(${c.node_count})`)
      .join(' · ');
    blocks.push([`CLUSTERS ${clusterLine}`]);
  }

  if (hotspots.length) {
    const hs = ['HOTSPOTS (god nodes, by in+out degree)'];
    for (const h of hotspots) {
      hs.push(`- ${h.label} ${(h.type || '').toLowerCase()} ${h.file_path} (deg ${h.degree}; ${h.fan_in} in / ${h.fan_out} out)`);
    }
    blocks.push(hs);
  }

  // GAPS — the under-connected tail (borrow: graphify isolated-nodes report).
  // Symbols with degree <=1 are likely missing edges / undocumented / dead — the
  // complement to HOTSPOTS. A degree-0/1 symbol that is ALSO heuristic-only is a
  // strong "review me" candidate (our trust layer adds signal graphify lacks).
  const isolated = computeIsolated(db, { limit: 8 });
  if (isolated.length) {
    const gaps = ['GAPS (isolated symbols, degree <=1 — likely missing edges / undocumented / dead code)'];
    for (const g of isolated) gaps.push(`- ${g.label} ${(g.type || '').toLowerCase()} ${g.file_path || ''} (deg ${g.degree})`);
    blocks.push(gaps);
  }

  if (prov.shader.bindings > 0 || prov.shader.loads_shader > 0 || prov.shader.declares_binding > 0) {
    blocks.push([
      `SHADER BINDINGS ${prov.shader.bindings} ShaderBinding node(s), `
      + `${prov.shader.declares_binding} DECLARES_BINDING, ${prov.shader.loads_shader} LOADS_SHADER`,
    ]);
  }

  if (prov.total_call_edges > 0) {
    const parts = Object.entries(prov.percentages)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}%`);
    const line = [`PROVENANCE ${prov.total_call_edges} call-family edges — ${parts.join(', ')}`];
    if (prov.lsp_verified_pct > 0) {
      line.push(`  ${prov.lsp_verified_pct}% LSP-verified`);
    }
    if (prov.overridden_by > 0) {
      line.push(`  ${prov.overridden_by} OVERRIDDEN_BY (virtual dispatch)`);
    }
    blocks.push(line);
  }

  if (cycles.length > 0) {
    const cy = [`CYCLES ${cycles.length} file-level import cycle(s), tightest first${capped ? ' (search capped)' : ''}`];
    for (const c of cycles) {
      cy.push(`- (${c.length}) ${c.join(' → ')} → ${c[0]}`);
    }
    blocks.push(cy);
  } else {
    blocks.push([`CYCLES none found (import/include graph is acyclic at file level)`]);
  }

  // COMMUNITY BRIDGES (borrow: graphify betweenness ranking + hub exclusion).
  // Rank inter-cluster connections by edge-betweenness on the cluster meta-graph
  // (true structural cut-points), with god-object hub edges excluded so they
  // don't make everything look coupled. Beats the old "heaviest single edge".
  const bridges = computeBridges(db, {
    architecture,
    excludeNodeIds: new Set(hotspots.map((h) => h.id)),
    topN: 5,
  });
  if (bridges.length) {
    const bl = ['COMMUNITY BRIDGES (highest edge-betweenness — structural cut-points; hub edges excluded)'];
    for (const b of bridges) {
      bl.push(`- ${b.from} ↔ ${b.to} (betweenness ${b.betweenness.toFixed(1)}, ${b.count} edge${b.count === 1 ? '' : 's'})`);
    }
    blocks.push(bl);
  }

  // SUGGESTED QUESTIONS (borrow: graphify report.py) — turn the facts above into
  // a short investigation agenda. Pairs structure (hubs / bridges / cycles / gaps)
  // with OUR trust data (LSP-verified vs heuristic) — a framing graphify can't do.
  const questions = [];
  if (hotspots[0]) questions.push(`Is ${hotspots[0].label} (deg ${hotspots[0].degree}) doing too much — a god object to split?`);
  if (prov.total_call_edges && prov.lsp_verified_pct < 100) {
    const heur = prov.total_call_edges - (prov.by_provenance?.LSP_VERIFIED || 0);
    if (heur > 0) questions.push(`${heur} of ${prov.total_call_edges} call edges are heuristic (${prov.lsp_verified_pct}% LSP-verified) — run graph_collect_code_intel + verify before any "no callers" claim.`);
  }
  if (cycles.length) questions.push(`Break the import cycle ${cycles[0].slice(0, 3).join(' → ')}${cycles[0].length > 3 ? ' → …' : ''}?`);
  if (bridges[0]) questions.push(`Is the ${bridges[0].from} ↔ ${bridges[0].to} coupling (highest-betweenness bridge, ${bridges[0].count} edge${bridges[0].count === 1 ? '' : 's'}) an intended seam, or a leak that fragments if cut?`);
  if (isolated[0]) questions.push(`Is ${isolated[0].label} (deg ${isolated[0].degree}) dead code or a missing edge?`);
  if (questions.length) blocks.push(['QUESTIONS (worth investigating)', ...questions.map((q) => `- ${q}`)]);

  // Assemble under the hard char budget; drop trailing blocks first, then note.
  let text = blocks.map((b) => b.join('\n')).join('\n\n');
  if (text.length > charBudget) {
    const kept = [];
    let used = 0;
    for (const b of blocks) {
      const chunk = b.join('\n');
      // Always keep the header block even if it alone exceeds budget.
      if (kept.length === 0 || used + chunk.length + 2 <= charBudget) {
        kept.push(chunk);
        used += chunk.length + 2;
      } else {
        break;
      }
    }
    kept.push('TRUNCATED — digest exceeded token budget; raise budget for full analysis');
    text = kept.join('\n\n');
  }
  return text;
}
