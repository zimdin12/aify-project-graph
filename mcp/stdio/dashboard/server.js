import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = join(fileURLToPath(import.meta.url), '..');

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

    // feature → file anchors (curated)
    for (const glob of (feature.anchors?.files || [])) {
      const rows = db.all(
        `SELECT file_path FROM nodes
         WHERE type IN ('File','Directory') AND file_path GLOB $g LIMIT 100`,
        { g: glob });
      for (const r of rows) {
        edges.push({
          from: featureNodeId,
          to: `file:${r.file_path}`,
          relation: 'ANCHORS',
          provenance: 'curated',
        });
      }
    }
    // feature → symbol anchors (curated)
    for (const symLabel of (feature.anchors?.symbols || [])) {
      const rows = db.all(
        `SELECT id, file_path FROM nodes WHERE label = $l LIMIT 5`,
        { l: symLabel });
      for (const r of rows) {
        edges.push({
          from: featureNodeId,
          to: `file:${r.file_path}`,
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
        edges.push({
          from: taskNodeId,
          to: `file:${filePath}`,
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
  const mentionsEdges = db.all(
    `SELECT d.file_path AS from_file, s.file_path AS to_file, s.label AS to_label
     FROM edges e
     JOIN nodes d ON d.id = e.from_id AND d.type = 'Document'
     JOIN nodes s ON s.id = e.to_id
     WHERE e.relation = 'MENTIONS'
     LIMIT 500`);
  for (const m of mentionsEdges) {
    edges.push({
      from: `file:${m.from_file}`,
      to: `file:${m.to_file}`,
      relation: 'MENTIONS',
      provenance: 'inferred',
    });
  }

  return { edges };
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
        source: f.source || 'user',
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
        source: tasksFile.source || 'unknown',
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
  });
  // Normalize a code edge to the unified edge shape.
  const normalizeCodeEdge = (e) => ({
    id: `edge:${e.from_id}->${e.to_id}:${e.relation}`,
    source: `code:${e.from_id}`,
    target: `code:${e.to_id}`,
    relation: e.relation,
    edge_class: 'code',
    provenance: 'code',
    confidence: e.confidence,
  });

  const server = http.createServer(async (req, res) => {
    const writeJson = (body) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'null' });
      res.end(JSON.stringify(body));
    };

    // API routes
    if (req.url === '/api/graph') {
      const nodes = db.all('SELECT * FROM nodes LIMIT 5000');
      const edges = db.all('SELECT * FROM edges LIMIT 10000');
      writeJson({ nodes, edges });
      return;
    }

    // Unified multi-layer graph: code + overlay (feature/task) nodes +
    // cross-layer edges, all normalized with { layer, edge_class,
    // provenance, confidence } per dev's interaction-layer contract.
    if (req.url === '/api/graph-multilayer') {
      const codeNodes = db.all(
        `SELECT id, type, label, file_path, start_line, language, confidence
         FROM nodes LIMIT 5000`).map(normalizeCodeNode);
      const codeEdges = db.all(
        `SELECT from_id, to_id, relation, confidence FROM edges LIMIT 10000`
      ).map(normalizeCodeEdge);

      const overlayNodes = buildOverlayNodes(repoRoot).map(n => ({
        id: n.id,
        label: n.label,
        layer: n.type === 'Feature' ? 'feature' : 'task',
        kind: n.type,
        description: n.description,
        status: n.status,
        source: n.source,
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
      const q = url.searchParams.get('q') || '';
      const results = db.all(
        'SELECT * FROM nodes WHERE label LIKE $q LIMIT 20',
        { q: `%${q}%` }
      );
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
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const url = `http://127.0.0.1:${addr.port}`;
      resolve({ url, server, port: addr.port });
    });
  });
}
