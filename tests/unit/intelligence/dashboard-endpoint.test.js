// Plan #16 Step A tests: /api/intelligence endpoint.
// Spins up the dashboard server against a tmp repo with intelligence
// overlays in .aify-graph/ and verifies the endpoint returns the
// validated overlays + layerSummary, OR null + warnings when invalid.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { startDashboard } from '../../../mcp/stdio/dashboard/server.js';

const VALID_SHA = 'sha256:' + 'c'.repeat(64);

function semanticOverlay() {
  return {
    schema_version: '0.1',
    generatorVersion: 'file-summarizer/0.1.0',
    generatedAt: '2026-05-22T00:00:00Z',
    graphHead: 'abc123',
    inputSha: VALID_SHA,
    files: [
      { path: 'src/api.js', summary: 'API router.', tags: ['api'], complexity: 'low', nodeType: 'api-handler', entryPoint: false },
      { path: 'src/util.js', summary: 'String helpers.', tags: ['util'], complexity: 'low', nodeType: 'utility', entryPoint: false }
    ]
  };
}

function architectureOverlay() {
  return {
    schema_version: '0.1',
    generatorVersion: 'architecture-layer-assigner/0.1.0',
    generatedAt: '2026-05-22T00:00:00Z',
    graphHead: 'abc123',
    inputSha: VALID_SHA,
    layers: [
      { id: 'api', name: 'API', description: 'HTTP handlers.', color: '#58a6ff' },
      { id: 'util', name: 'Util', description: 'Helpers.', color: '#bf8700' },
      { id: 'doc', name: 'Doc', description: 'Documentation.', color: '#8b949e' }
    ],
    assignments: {
      'src/api.js': { layerId: 'api', confidence: 'high', reason: 'api nodeType' },
      'src/util.js': { layerId: 'util', confidence: 'medium', reason: 'utility nodeType' }
    }
  };
}

function tmpRepoWithOverlays(overlays) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-dash-'));
  fs.mkdirSync(path.join(dir, '.aify-graph'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'api.js'), '// api');
  fs.writeFileSync(path.join(dir, 'src', 'util.js'), '// util');
  for (const [name, content] of Object.entries(overlays)) {
    fs.writeFileSync(path.join(dir, '.aify-graph', name), JSON.stringify(content));
  }
  const dbPath = path.join(dir, '.aify-graph', 'graph.sqlite');
  const db = openDb(dbPath);
  return { dir, db };
}

async function fetchJson(url) {
  const res = await fetch(url);
  return { status: res.status, body: await res.json() };
}

async function withDashboard(dir, db, fn) {
  const { server, port } = await startDashboard({ db, port: 0, repoRoot: dir });
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

// ── P2b analytics endpoints ────────────────────────────────────────────────
// Seed a small but realistic graph (community clusters, a god node, an
// import cycle, LSP_VERIFIED vs heuristic call edges, a shader binding) and
// hit every new endpoint through the live HTTP server.

function addNode(db, id, opts = {}) {
  const { type = 'Function', label = id, file_path = '', community_id = null, language = '' } = opts;
  const extra = community_id != null ? JSON.stringify({ community_id }) : '{}';
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, language, extra) VALUES ($id,$type,$label,$fp,$lang,$extra)`,
    { id, type, label, fp: file_path, lang: language, extra },
  );
}
function addEdge(db, from_id, to_id, opts = {}) {
  const { relation = 'CALLS', provenance = 'EXTRACTED' } = opts;
  db.run(
    `INSERT INTO edges (from_id, to_id, relation, provenance) VALUES ($f,$t,$r,$p)`,
    { f: from_id, t: to_id, r: relation, p: provenance },
  );
}

function tmpRepoWithSeededGraph() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-dash-p2b-'));
  fs.mkdirSync(path.join(dir, '.aify-graph'), { recursive: true });
  const dbPath = path.join(dir, '.aify-graph', 'graph.sqlite');
  const db = openDb(dbPath);
  // Community 1: a god node + two satellites in src/. Community 2: two in lib/.
  addNode(db, 'god', { community_id: 1, file_path: 'src/god.js', label: 'GodObject' });
  addNode(db, 's1', { community_id: 1, file_path: 'src/s1.js', label: 's1' });
  addNode(db, 's2', { community_id: 1, file_path: 'src/s2.js', label: 's2' });
  addNode(db, 'b1', { community_id: 2, file_path: 'lib/b1.js', label: 'b1' });
  addNode(db, 'b2', { community_id: 2, file_path: 'lib/b2.js', label: 'b2' });
  // A shader binding bridge.
  addNode(db, 'shb', { type: 'ShaderBinding', file_path: 'shaders/x.glsl', label: 'binding0', language: 'glsl' });
  // Degree: god gets fan-in/out; chain god→s1→s2 for pathfinding.
  addEdge(db, 's1', 'god', { provenance: 'LSP_VERIFIED' });
  addEdge(db, 's2', 'god', { provenance: 'LSP_VERIFIED' });
  addEdge(db, 'god', 's1', { provenance: 'EXTRACTED' });
  addEdge(db, 's1', 's2', { provenance: 'EXTRACTED' });
  addEdge(db, 'god', 'b1', { provenance: 'INFERRED' });   // inter-cluster
  addEdge(db, 'b1', 'b2', { provenance: 'LSP_VERIFIED' });
  // File-level import cycle a.js → b.js → a.js via these symbols.
  addEdge(db, 'b2', 'b1', { relation: 'IMPORTS' });        // not a file cycle (same dir, diff files ok)
  // Shader bridge edges.
  addEdge(db, 'god', 'shb', { relation: 'LOADS_SHADER' });
  addEdge(db, 'shb', 'b1', { relation: 'DECLARES_BINDING' });
  return { dir, db };
}

describe('P2b dashboard analytics endpoints', () => {
  let repo; let db;
  afterEach(() => { db?.close?.(); });

  it('/api/overview returns clusters sized by node_count with aggregated edges', async () => {
    ({ dir: repo, db } = tmpRepoWithSeededGraph());
    await withDashboard(repo, db, async (base) => {
      const { status, body } = await fetchJson(`${base}/api/overview`);
      expect(status).toBe(200);
      expect(Array.isArray(body.clusters)).toBe(true);
      expect(body.clusters.length).toBeGreaterThanOrEqual(2);
      // Largest cluster first; community 1 has the most members.
      expect(body.clusters[0].node_count).toBeGreaterThanOrEqual(body.clusters[1].node_count);
      const c1 = body.clusters.find(c => c.cluster === 'c:1');
      expect(c1).toBeTruthy();
      // c:1 → c:2 inter-cluster edge aggregated (god→b1).
      expect(c1.edges_to.some(e => e.cluster === 'c:2' && e.count >= 1)).toBe(true);
      expect(body.meta.cluster_count).toBe(body.clusters.length);
    });
  });

  it('/api/overview caps the long tail into an (other) aggregate box', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-dash-cap-'));
    fs.mkdirSync(path.join(dir, '.aify-graph'), { recursive: true });
    const capDb = openDb(path.join(dir, '.aify-graph', 'graph.sqlite'));
    // 40 single-node communities → exceeds the default cap of 24.
    for (let i = 0; i < 40; i++) addNode(capDb, `n${i}`, { community_id: i, file_path: `c${i}/f.js`, label: `n${i}` });
    try {
      await withDashboard(dir, capDb, async (base) => {
        const { body } = await fetchJson(`${base}/api/overview?cap=10`);
        expect(body.meta.capped).toBe(true);
        expect(body.meta.total_clusters).toBe(40);
        // 10 head clusters + 1 aggregate box.
        expect(body.clusters.length).toBe(11);
        const other = body.clusters.find(c => c.cluster.startsWith('other:'));
        expect(other).toBeTruthy();
        expect(other.label).toMatch(/other 30 clusters/);
        expect(other.node_count).toBe(30);
      });
    } finally { capDb.close(); }
  });

  it('/api/hotspots ranks god node and honors limit', async () => {
    ({ dir: repo, db } = tmpRepoWithSeededGraph());
    await withDashboard(repo, db, async (base) => {
      const { body } = await fetchJson(`${base}/api/hotspots?limit=3`);
      expect(body.hotspots.length).toBeLessThanOrEqual(3);
      expect(body.hotspots[0].label).toBe('GodObject');
    });
  });

  it('/api/impact returns changed + affected ids', async () => {
    ({ dir: repo, db } = tmpRepoWithSeededGraph());
    await withDashboard(repo, db, async (base) => {
      const { body } = await fetchJson(`${base}/api/impact/god?depth=3`);
      expect(body.changed).toEqual(['god']);
      // s1, s2 reach god via CALLS (backward walk).
      expect(body.affected).toEqual(expect.arrayContaining(['s1', 's2']));
      expect(body.affected).not.toContain('god');
    });
  });

  it('/api/impact strips the code: id prefix', async () => {
    ({ dir: repo, db } = tmpRepoWithSeededGraph());
    await withDashboard(repo, db, async (base) => {
      const { body } = await fetchJson(`${base}/api/impact/${encodeURIComponent('code:god')}`);
      expect(body.changed).toEqual(['god']);
    });
  });

  it('/api/path returns an ordered chain between two nodes', async () => {
    ({ dir: repo, db } = tmpRepoWithSeededGraph());
    await withDashboard(repo, db, async (base) => {
      const { body } = await fetchJson(`${base}/api/path?from=god&to=b2`);
      expect(body.found).toBe(true);
      expect(body.path[0]).toBe('god');
      expect(body.path[body.path.length - 1]).toBe('b2');
      // Each consecutive pair must share an edge (undirected) — sanity on chain.
      expect(body.path.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('/api/path returns found:false for disconnected nodes', async () => {
    ({ dir: repo, db } = tmpRepoWithSeededGraph());
    // add an island node with no edges
    addNode(db, 'island', { community_id: 9, file_path: 'iso/i.js', label: 'island' });
    await withDashboard(repo, db, async (base) => {
      const { body } = await fetchJson(`${base}/api/path?from=island&to=b2`);
      expect(body.found).toBe(false);
      expect(body.path).toEqual([]);
    });
  });

  it('/api/provenance returns call-edge counts + shader stats', async () => {
    ({ dir: repo, db } = tmpRepoWithSeededGraph());
    await withDashboard(repo, db, async (base) => {
      const { body } = await fetchJson(`${base}/api/provenance`);
      expect(body.total_call_edges).toBeGreaterThan(0);
      expect(body.by_provenance.LSP_VERIFIED).toBeGreaterThanOrEqual(1);
      expect(typeof body.lsp_verified_pct).toBe('number');
      expect(body.shader.bindings).toBe(1);
      expect(body.shader.loads_shader).toBe(1);
      expect(body.shader.declares_binding).toBe(1);
    });
  });

  it('/api/digest returns budgeted text starting with DIGEST', async () => {
    ({ dir: repo, db } = tmpRepoWithSeededGraph());
    const { server, port } = await startDashboard({ db, port: 0, repoRoot: repo });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/digest?budget=4000`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/text\/plain/);
      const text = await res.text();
      expect(text).toMatch(/^DIGEST /);
      expect(text).toContain('HOTSPOTS');
    } finally {
      await new Promise(r => server.close(r));
    }
  });

  it('/api/graph-multilayer code edges carry code_provenance for the ribbon', async () => {
    ({ dir: repo, db } = tmpRepoWithSeededGraph());
    await withDashboard(repo, db, async (base) => {
      const { body } = await fetchJson(`${base}/api/graph-multilayer`);
      const callEdge = body.edges.find(e => e.relation === 'CALLS');
      expect(callEdge).toBeTruthy();
      expect(['LSP_VERIFIED', 'EXTRACTED', 'INFERRED']).toContain(callEdge.code_provenance);
      expect(body.edges.some(e => e.code_provenance === 'LSP_VERIFIED')).toBe(true);
    });
  });

  it('/api/source serves an indexed file range but REFUSES un-indexed paths', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-src-'));
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.aify-graph'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'line1\nline2\nline3\nline4\n');
    fs.writeFileSync(path.join(dir, 'secret.txt'), 'TOP SECRET\n');
    const sdb = openDb(path.join(dir, '.aify-graph', 'graph.sqlite'));
    addNode(sdb, 'n1', { type: 'File', label: 'a.js', file_path: 'src/a.js' });
    try {
      await withDashboard(dir, sdb, async (base) => {
        const ok = await fetchJson(`${base}/api/source?path=src/a.js&from=2&to=3`);
        expect(ok.status).toBe(200);
        expect(ok.body.lines).toEqual(['line2', 'line3']);
        expect(ok.body.from).toBe(2);
        // A real file that is NOT a graph node must be refused (graph = allowlist).
        const denied = await fetchJson(`${base}/api/source?path=secret.txt&from=1&to=1`);
        expect(denied.body.error).toBe('not_indexed');
        expect(denied.body.lines).toBeUndefined();
      });
    } finally { sdb.close(); }
  });

  it('/api/tour returns ordered structured steps with title/why/refs (Guided Tour)', async () => {
    ({ dir: repo, db } = tmpRepoWithSeededGraph());
    await withDashboard(repo, db, async (base) => {
      const { status, body } = await fetchJson(`${base}/api/tour?steps=8`);
      expect(status).toBe(200);
      expect(Array.isArray(body.steps)).toBe(true);
      expect(body.steps.length).toBeGreaterThanOrEqual(1);
      const s = body.steps[0];
      expect(typeof s.title).toBe('string');
      expect(typeof s.why).toBe('string');
      expect(Array.isArray(s.refs)).toBe(true); // bare labels → focus pills
    });
  });
});

describe('P2b frontend wiring (structural)', () => {
  const html = fs.readFileSync(
    path.join(import.meta.dirname, '..', '..', '..', 'mcp', 'stdio', 'dashboard', 'static', 'index.html'),
    'utf8',
  );

  it('references every backing endpoint from the SPA', () => {
    // The rebuilt SPA computes the grouped Map overview client-side from the
    // already-loaded /api/graph-multilayer payload (so /api/overview is no
    // longer called by the browser — it stays a server/MCP-verb endpoint), but
    // it still wires the analysis + detail endpoints directly.
    expect(html).toContain('/api/graph-multilayer');
    expect(html).toContain('/api/hotspots');
    expect(html).toContain('/api/impact/');
    expect(html).toContain('/api/path?');
    expect(html).toContain('/api/provenance');
    expect(html).toContain('/api/search?');
    expect(html).toContain('/api/node/');
    expect(html).toContain('/api/tour');
    expect(html).toContain('/api/source?');
  });

  it('wires the core interactive features', () => {
    expect(html).toContain('buildGroupBoxElements'); // grouped Map overview (boxes)
    expect(html).toContain('drillInto');             // drill-in to a group's members
    expect(html).toContain('groupKeyFor');           // directory/community grouping
    expect(html).toContain('code_provenance');       // provenance ribbon
    expect(html).toContain('shaderViewIds');         // shader bridge view
    expect(html).toContain('renderIdleOverview');    // idle project overview panel
    expect(html).toContain('runBlastRadius');        // blast radius
    expect(html).toContain('runPathfinder');         // pathfinder
    // Mode-aware controls: blast/pathfinder (cytoscape-only) are gated out in 3D.
    expect(html).toContain('twoDOnlyTools');
    expect(html).toMatch(/is3DMode\s*\?\s*''\s*:/);
    // Heavy-render guard: per-node views cap node count so they can't freeze the UI.
    expect(html).toContain('RENDER_NODE_CAP');
    expect(html).toContain('cap-note');
    // Borrows: nav-history back-stack + hover degree tooltip.
    expect(html).toContain('nav-back-btn');
    expect(html).toContain('node-tip');
    expect(html).toContain('ensureDegMaps');
  });

  it('exposes map + shader view modes and ShaderBinding styling', () => {
    // VIEW_MODES is now [key, icon, label] triples; assert the map + shader keys.
    expect(html).toMatch(/VIEW_MODES\s*=/);
    expect(html).toMatch(/\['map'/);
    expect(html).toMatch(/\['shader'/);
    expect(html).toContain('ShaderBinding');
    expect(html).toContain('LSP-verified'); // trust language in legend + stat
  });

  it('app script is syntactically valid JS', () => {
    const blocks = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
    const app = blocks.map(b => b.replace(/^<script>/, '').replace(/<\/script>$/, ''))
      .filter(s => s.trim().length > 100).pop();
    expect(app).toBeTruthy();
    // new Function throws SyntaxError on a parse error; wrap in a function body
    // so top-level `await`/return aren't an issue (there are none here).
    expect(() => new Function(app)).not.toThrow();
  });
});

describe('/api/intelligence endpoint', () => {
  let repo;
  let db;

  afterEach(() => { db?.close?.(); });

  it('returns null fields + empty warnings when overlays absent', async () => {
    ({ dir: repo, db } = tmpRepoWithOverlays({}));
    await withDashboard(repo, db, async (base) => {
      const { status, body } = await fetchJson(`${base}/api/intelligence`);
      expect(status).toBe(200);
      expect(body.semanticFiles).toBeNull();
      expect(body.architecture).toBeNull();
      expect(body.layerSummary).toEqual([]);
      expect(body.warnings).toEqual([]);
    });
  });

  it('returns both overlays + layerSummary when valid', async () => {
    ({ dir: repo, db } = tmpRepoWithOverlays({
      'semantic.files.json': semanticOverlay(),
      'architecture.json': architectureOverlay()
    }));
    await withDashboard(repo, db, async (base) => {
      const { status, body } = await fetchJson(`${base}/api/intelligence`);
      expect(status).toBe(200);
      expect(body.semanticFiles?.files?.length).toBe(2);
      expect(body.architecture?.layers?.length).toBe(3);
      expect(body.layerSummary.length).toBe(3);
      const api = body.layerSummary.find(l => l.id === 'api');
      expect(api.fileCount).toBe(1);
      expect(api.name).toBe('API');
      expect(body.loadedFrom.semantic).toMatch(/semantic\.files\.json$/);
      expect(body.loadedFrom.architecture).toMatch(/architecture\.json$/);
    });
  });

  it('drops invalid architecture and surfaces warnings', async () => {
    const arch = architectureOverlay();
    arch.assignments['src/ghost.js'] = { layerId: 'api', confidence: 'high', reason: 'invented' };
    ({ dir: repo, db } = tmpRepoWithOverlays({
      'semantic.files.json': semanticOverlay(),
      'architecture.json': arch
    }));
    await withDashboard(repo, db, async (base) => {
      const { body } = await fetchJson(`${base}/api/intelligence`);
      expect(body.semanticFiles).not.toBeNull();
      expect(body.architecture).toBeNull();
      expect(body.layerSummary).toEqual([]);
      expect(body.warnings.some(w => w.includes('architecture.json failed'))).toBe(true);
    });
  });

  it('handles malformed semantic JSON gracefully (no crash, just null + warning)', async () => {
    ({ dir: repo, db } = tmpRepoWithOverlays({}));
    // Write a broken JSON file directly
    fs.writeFileSync(path.join(repo, '.aify-graph', 'semantic.files.json'), '{not-json');
    await withDashboard(repo, db, async (base) => {
      const { status, body } = await fetchJson(`${base}/api/intelligence`);
      expect(status).toBe(200);
      expect(body.semanticFiles).toBeNull();
    });
  });
});
