import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadIntelligenceOverlays, summarizeArchitectureLayers } from '../intelligence/overlays.js';
import { searchNodesFts } from '../storage/nodes.js';
import { buildTour } from '../query/verbs/tour.js';
import {
  computeOverview,
  computeHotspots,
  computeProvenanceMix,
  computeDigest,
} from '../intelligence/analytics.js';

const __dirname = join(fileURLToPath(import.meta.url), '..');
const DASHBOARD_NODE_LIMIT = 25000;
const DASHBOARD_EDGE_LIMIT = 120000;

// Load a JSON overlay file from .aify-graph/, tolerating missing files.
function loadOverlayJson(repoRoot, name) {
  const p = join(repoRoot, '.aify-graph', name);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

// Build cross-layer edges from overlay data + graph nodes.
// Returns {edges: [{from, to, relation, provenance}]} where provenance is
// "curated" (user wrote it in overlay), "inferred" (derived from code graph
// MENTIONS / anchor match), or "code" (regular code graph edge).
function computeCrossLayerEdges(db, repoRoot) {
  const overlay = loadOverlayJson(repoRoot, 'functionality.json');
  const tasksFile = loadOverlayJson(repoRoot, 'tasks.json');
  const edges = [];
  if (!overlay?.features) return { edges };

  const featureIds = new Set(overlay.features.map(f => f.id));

  for (const feature of overlay.features) {
    const featureNodeId = `feature:${feature.id}`;

    // feature → file anchors (curated). Endpoint uses `code:${id}` to match
    // how code-layer nodes are emitted in buildMultilayerGraph — otherwise
    // the frontend drops these edges as orphans (bug caught 2026-04-20
    // cross-tester round: every feature→file edge was silently filtered).
    for (const glob of (feature.anchors?.files || [])) {
      const rows = db.all(
        `SELECT id, file_path FROM nodes
         WHERE type IN ('File','Directory') AND file_path GLOB $g LIMIT 100`,
        { g: glob });
      for (const r of rows) {
        edges.push({
          from: featureNodeId,
          to: `code:${r.id}`,
          relation: 'ANCHORS',
          provenance: 'curated',
        });
      }
    }
    // feature → symbol anchors (curated). Target the symbol node itself
    // (not its file) so the edge ends at the specific anchor.
    for (const symLabel of (feature.anchors?.symbols || [])) {
      const rows = db.all(
        `SELECT id FROM nodes WHERE label = $l LIMIT 5`,
        { l: symLabel });
      for (const r of rows) {
        edges.push({
          from: featureNodeId,
          to: `code:${r.id}`,
          relation: 'ANCHORS',
          provenance: 'curated',
        });
      }
    }
    // feature → feature curated edges (depends_on, related_to)
    for (const dep of (feature.depends_on || [])) {
      if (!featureIds.has(dep)) continue;
      edges.push({
        from: featureNodeId,
        to: `feature:${dep}`,
        relation: 'DEPENDS_ON',
        provenance: 'curated',
      });
    }
    for (const rel of (feature.related_to || [])) {
      if (!featureIds.has(rel)) continue;
      edges.push({
        from: featureNodeId,
        to: `feature:${rel}`,
        relation: 'RELATED_TO',
        provenance: 'curated',
      });
    }
  }

  // tasks → feature links (curated via task.features)
  if (tasksFile?.tasks) {
    for (const task of tasksFile.tasks) {
      const taskNodeId = `task:${task.id}`;
      for (const fid of (task.features || [])) {
        if (!featureIds.has(fid)) continue;
        edges.push({
          from: taskNodeId,
          to: `feature:${fid}`,
          relation: 'TARGETS',
          provenance: 'curated',
        });
      }
      for (const filePath of (task.files_hint || [])) {
        const fileNode = db.get(
          `SELECT id FROM nodes WHERE type = 'File' AND file_path = $p LIMIT 1`,
          { p: filePath });
        if (!fileNode) continue;
        edges.push({
          from: taskNodeId,
          to: `code:${fileNode.id}`,
          relation: 'HINTS',
          provenance: 'curated',
        });
      }
    }
  }

  // doc → code links (inferred from MENTIONS edges)
  // Since Documents are already in nodes table, these edges exist in the
  // edges table already — we tag them for the dashboard to style differently.
  // Returned here as "inferred" cross-layer edges.
  // MENTIONS edges (doc → code). Use node ids directly so the endpoints
  // match the `code:${id}` format of emitted code-layer nodes. Both docs
  // and code nodes are in the code layer here (doc nodes live on layer
  // 'doc' but use the same `code:${id}` id convention per server.js:179).
  const mentionsEdges = db.all(
    `SELECT e.from_id AS from_id, e.to_id AS to_id
     FROM edges e
     JOIN nodes d ON d.id = e.from_id AND d.type = 'Document'
     WHERE e.relation = 'MENTIONS'
     LIMIT 500`);
  for (const m of mentionsEdges) {
    edges.push({
      from: `code:${m.from_id}`,
      to: `code:${m.to_id}`,
      relation: 'MENTIONS',
      provenance: 'inferred',
    });
  }

  return { edges };
}

// Relations that propagate "impact" (what's affected if I change X). Mirrors
// query/verbs/impact.js IMPACT_RELATIONS so the dashboard blast-radius and the
// MCP verb agree on what counts as a dependency edge.
const IMPACT_RELATIONS = ['CALLS', 'REFERENCES', 'USES_TYPE', 'TESTS', 'INVOKES', 'PASSES_THROUGH'];

// Strip the dashboard's `code:` id prefix so callers can pass either the raw
// graph node id or the dashboard-normalized id.
function rawNodeId(id) {
  if (id == null) return id;
  const s = String(id);
  return s.startsWith('code:') ? s.slice('code:'.length) : s;
}

// Blast-radius: starting from `nodeId`, walk dependency edges BACKWARD (callers
// of callers) up to `depth` hops. Returns the changed node + every reachable
// affected node id (raw graph ids). Bounded by a hard node cap so a hub can't
// explode the payload. Mirrors the recursive-impact traversal in impact.js but
// returns ids only (the dashboard already has node detail).
function computeImpact(db, nodeId, { depth = 3, cap = 2000 } = {}) {
  const start = rawNodeId(nodeId);
  const exists = db.get('SELECT id FROM nodes WHERE id = $id', { id: start });
  if (!exists) return { changed: [], affected: [] };

  const relSet = new Set(IMPACT_RELATIONS);
  const affected = new Set();
  let frontier = [start];
  let hops = 0;
  while (frontier.length && hops < depth && affected.size < cap) {
    const placeholders = frontier.map((_, i) => `$f${i}`).join(',');
    const params = Object.fromEntries(frontier.map((id, i) => [`f${i}`, id]));
    const rows = db.all(
      `SELECT DISTINCT from_id, relation FROM edges WHERE to_id IN (${placeholders})`,
      params,
    );
    const next = [];
    for (const r of rows) {
      if (!relSet.has(r.relation)) continue;
      if (r.from_id === start || affected.has(r.from_id)) continue;
      affected.add(r.from_id);
      next.push(r.from_id);
      if (affected.size >= cap) break;
    }
    frontier = next;
    hops += 1;
  }
  return { changed: [start], affected: [...affected] };
}

// Bidirectional BFS shortest path over the edge table (relation-agnostic,
// treated as undirected for reachability — agents want "are these connected and
// how", not strictly directed). Returns an ordered chain of raw node ids, or
// [] when no path exists. Bounded by a visited-node cap.
function computePath(db, fromId, toId, { cap = 20000 } = {}) {
  const from = rawNodeId(fromId);
  const to = rawNodeId(toId);
  if (!from || !to) return [];
  if (from === to) return [from];
  if (!db.get('SELECT id FROM nodes WHERE id = $id', { id: from })) return [];
  if (!db.get('SELECT id FROM nodes WHERE id = $id', { id: to })) return [];

  // neighbors(id) → both directions, so the path can traverse an edge either way.
  const neighbors = (id) => {
    const rows = db.all(
      `SELECT to_id AS other FROM edges WHERE from_id = $id
       UNION
       SELECT from_id AS other FROM edges WHERE to_id = $id`,
      { id },
    );
    return rows.map((r) => r.other);
  };

  const parentF = new Map([[from, null]]); // forward search: node → predecessor
  const parentB = new Map([[to, null]]);   // backward search: node → successor
  let frontF = [from];
  let frontB = [to];
  let meet = null;

  const reconstruct = (mid) => {
    const left = [];
    for (let n = mid; n != null; n = parentF.get(n)) left.push(n);
    left.reverse();
    const right = [];
    for (let n = parentB.get(mid); n != null; n = parentB.get(n)) right.push(n);
    return [...left, ...right];
  };

  while (frontF.length && frontB.length && !meet) {
    // Expand the smaller frontier (classic bidirectional optimization).
    if (frontF.length <= frontB.length) {
      const nextF = [];
      for (const node of frontF) {
        for (const nb of neighbors(node)) {
          if (parentF.has(nb)) continue;
          parentF.set(nb, node);
          if (parentB.has(nb)) { meet = nb; break; }
          nextF.push(nb);
        }
        if (meet) break;
      }
      frontF = nextF;
    } else {
      const nextB = [];
      for (const node of frontB) {
        for (const nb of neighbors(node)) {
          if (parentB.has(nb)) continue;
          parentB.set(nb, node);
          if (parentF.has(nb)) { meet = nb; break; }
          nextB.push(nb);
        }
        if (meet) break;
      }
      frontB = nextB;
    }
    if (parentF.size + parentB.size > cap) break; // bound the search
  }

  return meet ? reconstruct(meet) : [];
}

// Synthesize overlay nodes (feature+task) so the frontend can render them
// as first-class graph nodes alongside code nodes.
function buildOverlayNodes(repoRoot) {
  const overlay = loadOverlayJson(repoRoot, 'functionality.json');
  const tasksFile = loadOverlayJson(repoRoot, 'tasks.json');
  const nodes = [];
  if (overlay?.features) {
    for (const f of overlay.features) {
      nodes.push({
        id: `feature:${f.id}`,
        type: 'Feature',
        label: f.label || f.id,
        description: f.description || '',
        tags: f.tags || [],
        origin: f.source || 'user',
        depends_on: f.depends_on || [],
        related_to: f.related_to || [],
        anchors: f.anchors || {},
      });
    }
  }
  if (tasksFile?.tasks) {
    for (const t of tasksFile.tasks) {
      nodes.push({
        id: `task:${t.id}`,
        type: 'Task',
        label: t.title || t.id,
        status: t.status || 'unknown',
        task_id: t.id,
        url: t.url,
        assignee: t.assignee,
        features: t.features || [],
        files_hint: t.files_hint || [],
        origin: tasksFile.source || 'unknown',
      });
    }
  }
  return nodes;
}

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

export function startDashboard({ db, port = 0, repoRoot = process.cwd() }) {
  const nodeColumns = new Set(db.all('PRAGMA table_info(nodes)').map((row) => row.name));
  const hasCommunityId = nodeColumns.has('community_id');
  // community_id lives in the `extra` JSON (analysis/communities.js), not a
  // column — read it from there so the "by community" grouping + archetype
  // names actually work (previously every node fell into one "(uncommunitied)"
  // box because we read a nonexistent column).
  const communityIdOf = (n) => {
    if (n.community_id != null) return n.community_id;
    if (n.extra) { try { const v = JSON.parse(n.extra)?.community_id; if (v != null) return v; } catch {} }
    return null;
  };
  // Normalize a code-graph node to the unified dashboard shape.
  const normalizeCodeNode = (n) => ({
    id: `code:${n.id}`,
    label: n.label,
    layer: n.type === 'Document' ? 'doc' : 'code',
    kind: n.type,
    file_path: n.file_path,
    start_line: n.start_line,
    language: n.language,
    confidence: n.confidence,
    community_id: communityIdOf(n),
  });
  // Normalize a code edge to the unified edge shape.
  const normalizeCodeEdge = (e) => ({
    id: `edge:${e.from_id}->${e.to_id}:${e.relation}`,
    source: `code:${e.from_id}`,
    target: `code:${e.to_id}`,
    relation: e.relation,
    edge_class: 'code',
    provenance: 'code', // edge-class provenance (code|curated|inferred) — drives the filter pills
    // P2-4 provenance ribbon: the REAL graph provenance of this code edge
    // (LSP_VERIFIED | EXTRACTED | INFERRED). Kept separate from the edge-class
    // `provenance` above so the cross-layer filter contract is unchanged.
    code_provenance: e.provenance || 'EXTRACTED',
    confidence: e.confidence,
  });

  const server = http.createServer(async (req, res) => {
    const writeJson = (body) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'null' });
      res.end(JSON.stringify(body));
    };

    // Crash-guard: the dashboard http server runs IN-PROCESS with the MCP stdio
    // server, and queries on its long-lived db handle can throw (e.g. SQLITE_BUSY
    // when a concurrent ensureFresh/post-commit reindex commits). An uncaught
    // async throw here would become an unhandled rejection and could terminate
    // the whole MCP server — so every route runs inside this try.
    try {
    // API routes
    if (req.url === '/api/graph') {
      const totalNodes = db.get('SELECT count(*) AS c FROM nodes').c;
      const totalEdges = db.get('SELECT count(*) AS c FROM edges').c;
      const nodes = db.all(`SELECT * FROM nodes LIMIT ${DASHBOARD_NODE_LIMIT}`);
      const edges = db.all(`SELECT * FROM edges LIMIT ${DASHBOARD_EDGE_LIMIT}`);
      writeJson({
        nodes,
        edges,
        meta: {
          total_nodes: totalNodes,
          total_edges: totalEdges,
          truncated_nodes: totalNodes > DASHBOARD_NODE_LIMIT,
          truncated_edges: totalEdges > DASHBOARD_EDGE_LIMIT,
        },
      });
      return;
    }

    // Unified multi-layer graph: code + overlay (feature/task) nodes +
    // cross-layer edges, all normalized with { layer, edge_class,
    // provenance, confidence } per dev's interaction-layer contract.
    if (req.url === '/api/graph-multilayer') {
      const totalNodes = db.get('SELECT count(*) AS c FROM nodes').c;
      const totalEdges = db.get('SELECT count(*) AS c FROM edges').c;
      const codeNodes = db.all(
        `SELECT id, type, label, file_path, start_line, language, confidence, extra${hasCommunityId ? ', community_id' : ''}
         FROM nodes
         ORDER BY ${hasCommunityId ? 'COALESCE(community_id, 2147483647),' : ''} type, id
         LIMIT ${DASHBOARD_NODE_LIMIT}`).map(normalizeCodeNode);
      const codeEdges = db.all(
        `SELECT from_id, to_id, relation, confidence, provenance FROM edges
         ORDER BY relation, from_id, to_id
         LIMIT ${DASHBOARD_EDGE_LIMIT}`
      ).map(normalizeCodeEdge);

      const overlayNodes = buildOverlayNodes(repoRoot).map(n => ({
        id: n.id,
        label: n.label,
        layer: n.type === 'Feature' ? 'feature' : 'task',
        kind: n.type,
        description: n.description,
        status: n.status,
        origin: n.origin,
        feature_id: n.type === 'Feature' ? n.id.slice('feature:'.length) : undefined,
        task_id: n.type === 'Task' ? n.task_id : undefined,
        url: n.url,
        assignee: n.assignee,
        tags: n.tags,
        depends_on: n.depends_on,
        related_to: n.related_to,
        features: n.features,
      }));

      const cross = computeCrossLayerEdges(db, repoRoot);
      // Tag each cross-edge with edge_class by inspecting endpoints
      const crossEdges = cross.edges.map((e, i) => ({
        id: `cross:${i}:${e.from}->${e.to}:${e.relation}`,
        source: e.from,
        target: e.to,
        relation: e.relation,
        edge_class: 'cross-layer',
        provenance: e.provenance,
      }));

      writeJson({
        nodes: [...codeNodes, ...overlayNodes],
        edges: [...codeEdges, ...crossEdges],
        counts: {
          code_nodes: codeNodes.length,
          feature_nodes: overlayNodes.filter(n => n.layer === 'feature').length,
          task_nodes: overlayNodes.filter(n => n.layer === 'task').length,
          doc_nodes: codeNodes.filter(n => n.layer === 'doc').length,
          code_edges: codeEdges.length,
          cross_edges: crossEdges.length,
        },
        meta: {
          total_code_nodes: totalNodes,
          total_code_edges: totalEdges,
          truncated_nodes: totalNodes > DASHBOARD_NODE_LIMIT,
          truncated_edges: totalEdges > DASHBOARD_EDGE_LIMIT,
        },
      });
      return;
    }

    // Lightweight overlay-only endpoint — for filter panels / trust summaries.
    if (req.url === '/api/overlay') {
      const functionality = loadOverlayJson(repoRoot, 'functionality.json');
      const tasks = loadOverlayJson(repoRoot, 'tasks.json');
      writeJson({ functionality, tasks });
      return;
    }

    // Plan #16 Step A: intelligence overlays (semantic.files.json +
    // architecture.json). Both validated via Plan #15 A2 validators;
    // returns null fields + warnings when overlays absent or invalid.
    // Client uses this for layer color-grouping, semantic detail panel,
    // and extended search.
    if (req.url === '/api/intelligence') {
      const functionalityOverlay = loadOverlayJson(repoRoot, 'functionality.json');
      const intel = loadIntelligenceOverlays({ repoRoot, functionalityJson: functionalityOverlay });
      writeJson({
        semanticFiles: intel.semanticFiles,
        architecture: intel.architecture,
        layerSummary: summarizeArchitectureLayers(intel.architecture),
        warnings: intel.warnings,
        loadedFrom: intel.loadedFrom,
      });
      return;
    }

    // ── P2b analytics endpoints — all delegate to the shared analytics.js so
    // the dashboard and the MCP verbs never drift. Architecture overlay (if
    // present) sharpens overview clustering + digest layering.
    const loadArchitecture = () => {
      const functionalityOverlay = loadOverlayJson(repoRoot, 'functionality.json');
      const intel = loadIntelligenceOverlays({ repoRoot, functionalityJson: functionalityOverlay });
      return intel.architecture || null;
    };

    // P2-1: cluster/community map + aggregated inter-cluster edges. The legible
    // front door — bounded to ~8-30 boxes, never the raw 25k nodes. When a repo
    // has a long tail of tiny communities (this self-graph has ~580), we keep
    // the top `cap` by node_count and fold the rest into a single "(other …)"
    // aggregate box so the front door stays readable. The full unbounded map is
    // still available via the graph_overview MCP verb.
    if (req.url?.startsWith('/api/overview')) {
      const url = new URL(req.url, 'http://localhost');
      const cap = Math.max(4, Math.min(60, parseInt(url.searchParams.get('cap') || '24', 10) || 24));
      const architecture = loadArchitecture();
      const all = computeOverview(db, { topSymbols: 5, architecture });
      let clusters = all;
      if (all.length > cap) {
        const head = all.slice(0, cap);
        const tail = all.slice(cap);
        const headKeys = new Set(head.map((c) => c.cluster));
        const otherKey = `other:${tail.length}`;
        const otherCount = tail.reduce((s, c) => s + c.node_count, 0);
        // Aggregate every edge from a tail cluster into/out of the "(other)"
        // box, and rewrite head-cluster edges that pointed at a tail cluster.
        const otherEdges = new Map(); // targetKey → count
        for (const c of tail) {
          for (const e of c.edges_to) {
            const tgt = headKeys.has(e.cluster) ? e.cluster : otherKey;
            if (tgt === otherKey) continue; // collapse tail↔tail
            otherEdges.set(tgt, (otherEdges.get(tgt) || 0) + e.count);
          }
        }
        for (const c of head) {
          const folded = new Map();
          for (const e of c.edges_to) {
            const tgt = headKeys.has(e.cluster) ? e.cluster : otherKey;
            folded.set(tgt, (folded.get(tgt) || 0) + e.count);
          }
          c.edges_to = [...folded].map(([cluster, count]) => ({ cluster, count }))
            .sort((a, b) => b.count - a.count);
        }
        const otherBox = {
          cluster: otherKey,
          label: `(other ${tail.length} clusters)`,
          node_count: otherCount,
          top_symbols: [],
          edges_to: [...otherEdges].map(([cluster, count]) => ({ cluster, count }))
            .sort((a, b) => b.count - a.count),
        };
        clusters = [...head, otherBox];
      }
      writeJson({
        clusters,
        meta: {
          cluster_count: clusters.length,
          total_clusters: all.length,
          capped: all.length > cap,
          total_nodes: db.get('SELECT count(*) AS c FROM nodes').c,
        },
      });
      return;
    }

    // Archetype map: community_id → { name, id, confidence } from the heuristic
    // archetype classifier (shared analytics). Lets the dashboard's "by
    // community" Map label groups by PURPOSE ("Physics", "Rendering") instead of
    // "cluster N". Uncapped (unlike /api/overview) so every community resolves.
    if (req.url === '/api/archetypes') {
      const architecture = loadArchitecture();
      const clusters = computeOverview(db, { topSymbols: 6, architecture });
      const map = {};
      for (const c of clusters) {
        if (!c.cluster.startsWith('c:')) continue;
        const cid = c.cluster.slice(2);
        map[cid] = { name: c.archetype?.name || c.label, id: c.archetype?.id || null, confidence: c.archetype?.confidence || 'low' };
      }
      writeJson({ archetypes: map });
      return;
    }

    // Guided Tour (borrow: understand-anything LearnPanel) — ordered orientation
    // steps (entrypoints → archetype regions → hotspots) the frontend renders as
    // a click-through stepper. Data already computed by buildTour (graph_tour).
    if (req.url?.startsWith('/api/tour')) {
      const url = new URL(req.url, 'http://localhost');
      const steps = Math.max(1, Math.min(20, parseInt(url.searchParams.get('steps') || '8', 10) || 8));
      const focus = url.searchParams.get('focus') || null;
      const architecture = loadArchitecture();
      const tourSteps = buildTour(db, { steps, focus, architecture, json: true });
      writeJson({ steps: Array.isArray(tourSteps) ? tourSteps : [] });
      return;
    }

    // P2-6: top-N god nodes by in+out degree (clickable hotspot list).
    if (req.url?.startsWith('/api/hotspots')) {
      const url = new URL(req.url, 'http://localhost');
      const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get('limit') || '10', 10) || 10));
      const hotspots = computeHotspots(db, { limit });
      writeJson({ hotspots });
      return;
    }

    // P2-2: blast-radius — node + everything reachable backward over dependency
    // edges. Returns raw graph ids; the frontend maps to its `code:` nodes.
    if (req.url?.startsWith('/api/impact/')) {
      const url = new URL(req.url, 'http://localhost');
      const id = decodeURIComponent(url.pathname.slice('/api/impact/'.length));
      const depth = Math.max(1, Math.min(10, parseInt(url.searchParams.get('depth') || '3', 10) || 3));
      const result = computeImpact(db, id, { depth });
      writeJson(result);
      return;
    }

    // P2-5: pathfinder — bidirectional BFS shortest path A→B (ordered id chain).
    if (req.url?.startsWith('/api/path')) {
      const url = new URL(req.url, 'http://localhost');
      const from = url.searchParams.get('from') || '';
      const to = url.searchParams.get('to') || '';
      const path = computePath(db, from, to);
      writeJson({ from: rawNodeId(from), to: rawNodeId(to), path, found: path.length > 0 });
      return;
    }

    // P2-4: provenance mix — call-edge LSP-verified split + shader-binding counts.
    if (req.url === '/api/provenance') {
      writeJson(computeProvenanceMix(db));
      return;
    }

    // P2-9: token-budgeted text digest (the dashboard's whole analytic value in
    // ~1-2k tokens) so the browser can show the agent-digest too.
    if (req.url?.startsWith('/api/digest')) {
      const url = new URL(req.url, 'http://localhost');
      const budget = Math.max(800, Math.min(40000, parseInt(url.searchParams.get('budget') || '6000', 10) || 6000));
      const architecture = loadArchitecture();
      const text = computeDigest(db, { budget, architecture });
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': 'null' });
      res.end(text);
      return;
    }

    if (req.url === '/api/stats') {
      const nodeCount = db.get('SELECT count(*) AS c FROM nodes').c;
      const edgeCount = db.get('SELECT count(*) AS c FROM edges').c;
      const types = db.all('SELECT type, count(*) AS c FROM nodes GROUP BY type ORDER BY c DESC');
      const relations = db.all('SELECT relation, count(*) AS c FROM edges GROUP BY relation ORDER BY c DESC');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'null' });
      res.end(JSON.stringify({ nodeCount, edgeCount, types, relations }));
      return;
    }

    if (req.url?.startsWith('/api/search?')) {
      const url = new URL(req.url, `http://localhost`);
      const rawQ = (url.searchParams.get('q') || '').slice(0, 100);
      // Plan #17 A: FTS5-backed search. searchNodesFts() escapes special
      // chars, prefix-matches each token, and falls back to SQL LIKE if
      // FTS5 is unavailable. Server is bound to 127.0.0.1 only; the cap
      // at 100 chars + 8 token slice in the helper protects against
      // pathological inputs.
      const results = searchNodesFts(db, rawQ, 20);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'null' });
      res.end(JSON.stringify(results));
      return;
    }

    if (req.url?.startsWith('/api/node/')) {
      const id = decodeURIComponent(req.url.slice('/api/node/'.length));
      const node = db.get('SELECT * FROM nodes WHERE id = $id', { id });
      const incoming = db.all(`
        SELECT e.*, n.id AS from_id, n.label AS from_label, n.type AS from_type,
               n.file_path AS from_file, n.start_line AS from_line
        FROM edges e
        JOIN nodes n ON n.id = e.from_id
        WHERE e.to_id = $id
        ORDER BY e.relation, e.confidence DESC, n.label
        LIMIT 20
      `, { id });
      const outgoing = db.all(`
        SELECT e.*, n.id AS to_id, n.label AS to_label, n.type AS to_type,
               n.file_path AS to_file, n.start_line AS to_line
        FROM edges e
        JOIN nodes n ON n.id = e.to_id
        WHERE e.from_id = $id
        ORDER BY e.relation, e.confidence DESC, n.label
        LIMIT 20
      `, { id });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'null' });
      res.end(JSON.stringify({ node, incoming, outgoing }));
      return;
    }

    // Inline source viewer (borrow: understand-anything CodeViewer). SECURITY:
    // only serve a file that appears as a graph node's file_path — the graph IS
    // the allowlist, so this can't read arbitrary files. Returns the requested
    // line range (capped), highlighted client-side.
    if (req.url?.startsWith('/api/source')) {
      const url = new URL(req.url, 'http://localhost');
      const rel = (url.searchParams.get('path') || '').replace(/\\/g, '/');
      const from = Math.max(1, parseInt(url.searchParams.get('from') || '1', 10) || 1);
      const toReq = Math.max(from, parseInt(url.searchParams.get('to') || String(from), 10) || from);
      const to = Math.min(toReq, from + 600); // hard cap on lines served
      const known = rel && db.get('SELECT 1 AS ok FROM nodes WHERE file_path = $p LIMIT 1', { p: rel });
      if (!known) { writeJson({ error: 'not_indexed', path: rel }); return; }
      const root = resolve(repoRoot);
      const abs = resolve(repoRoot, rel);
      if (abs !== root && !abs.startsWith(root + sep)) { writeJson({ error: 'out_of_tree' }); return; }
      let allLines = [];
      try { allLines = readFileSync(abs, 'utf8').split('\n'); } catch { writeJson({ error: 'read_failed', path: rel }); return; }
      const slice = allLines.slice(from - 1, Math.min(allLines.length, to));
      writeJson({ path: rel, from, to: from - 1 + slice.length, lines: slice });
      return;
    }

    // Git-diff overlay (borrow: understand-anything change-overlay). Seed a
    // "what did I just touch" highlight from a REAL git diff instead of a hand-
    // picked blast node. Returns the changed files that are also graph nodes
    // (the graph is the allowlist, same as /api/source) so the client can light
    // up their nodes. Tolerates non-git repos / git-not-installed: returns an
    // empty set with a reason rather than throwing.
    if (req.url?.startsWith('/api/diff')) {
      const url = new URL(req.url, 'http://localhost');
      const base = (url.searchParams.get('base') || 'HEAD').replace(/[^\w./~^-]/g, ''); // sanitize the rev
      const gitLines = (args) => {
        try {
          return execFileSync('git', ['-C', repoRoot, ...args], {
            encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
          }).split('\n').map(s => s.trim()).filter(Boolean);
        } catch { return null; }
      };
      // Tracked changes vs base (staged + unstaged) + untracked-but-not-ignored.
      const tracked = gitLines(['diff', '--name-only', base]);
      if (tracked === null) { writeJson({ files: [], changed: 0, error: 'not_a_git_repo_or_git_missing', base }); return; }
      const untracked = gitLines(['ls-files', '--others', '--exclude-standard']) || [];
      const all = [...new Set([...tracked, ...untracked].map(p => p.replace(/\\/g, '/')))];
      // Keep only files that are graph nodes — same allowlist contract as /api/source.
      const indexed = all.filter(rel => db.get('SELECT 1 AS ok FROM nodes WHERE file_path = $p LIMIT 1', { p: rel }));
      writeJson({ files: indexed, changed: all.length, indexed: indexed.length, base });
      return;
    }

    // Vendored JS libs — serve cytoscape + 3d-force-graph + the layout/grouping
    // extensions from node_modules. Drops the unpkg dependency that was freezing
    // Edge on cold loads when the CDN hung or the browser blocked third-party
    // scripts. The fcose stack (layout-base → cose-base → cytoscape-fcose) gives
    // compound-aware spacing; cytoscape-dagre gives layered tree/flow layouts;
    // cytoscape-expand-collapse powers drill-in on the grouped Map view. All are
    // single-file UMD builds — no bundler/build step (keeps the dashboard
    // launchable instantly via the graph_dashboard verb in any repo).
    const VENDOR_MAP = {
      '/vendor/cytoscape.min.js': '../../../node_modules/cytoscape/dist/cytoscape.min.js',
      '/vendor/3d-force-graph.min.js': '../../../node_modules/3d-force-graph/dist/3d-force-graph.min.js',
      '/vendor/layout-base.js': '../../../node_modules/layout-base/layout-base.js',
      '/vendor/cose-base.js': '../../../node_modules/cose-base/cose-base.js',
      '/vendor/cytoscape-fcose.js': '../../../node_modules/cytoscape-fcose/cytoscape-fcose.js',
      '/vendor/cytoscape-dagre.js': '../../../node_modules/cytoscape-dagre/cytoscape-dagre.js',
      '/vendor/cytoscape-expand-collapse.js': '../../../node_modules/cytoscape-expand-collapse/cytoscape-expand-collapse.js',
    };
    if (VENDOR_MAP[req.url]) {
      const pkgMap = VENDOR_MAP;
      try {
        const path = resolve(join(__dirname, pkgMap[req.url]));
        const content = await readFile(path);
        res.writeHead(200, {
          'Content-Type': 'application/javascript',
          'Cache-Control': 'public, max-age=86400',
        });
        res.end(content);
      } catch (err) {
        res.writeHead(500);
        res.end(`vendor lib missing — run 'npm install' in the aify-project-graph clone. ${err.message}`);
      }
      return;
    }

    // Static files — serve the SPA (with path traversal protection)
    let filePath = req.url === '/' ? '/index.html' : req.url;
    const staticDir = resolve(join(__dirname, 'static'));
    const resolved = resolve(join(staticDir, filePath));
    if (!resolved.startsWith(staticDir)) {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }
    try {
      const content = await readFile(resolved);
      const ext = extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
      res.end(content);
    } catch {
      // Fallback to index.html for SPA routing
      try {
        const content = await readFile(join(__dirname, 'static', 'index.html'));
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
    }
    } catch (err) {
      // Never let a route throw take down the process. Respond 500 if we still can.
      try {
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`dashboard error: ${err?.message ?? err}`);
      } catch { /* response already torn down */ }
    }
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const url = `http://127.0.0.1:${addr.port}`;
      resolve({ url, server, port: addr.port });
    });
  });
}
