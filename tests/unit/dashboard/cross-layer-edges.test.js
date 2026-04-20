// Regression test for round-4 audit fix (2026-04-20):
// computeCrossLayerEdges previously emitted endpoints as `file:${path}` but
// code-layer nodes get IDs `code:${stableId}`. The frontend filter at
// index.html:438 drops edges whose endpoints aren't in the node set,
// silently killing every feature→file, task→file, and doc→code edge.
// The fix is to resolve File nodes to their graph id and emit `code:${id}`.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { startDashboard } from '../../../mcp/stdio/dashboard/server.js';

describe('dashboard — cross-layer edge endpoints (round-4 regression)', () => {
  let repoRoot;
  let server;
  let url;
  let db;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-dash-'));
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
    db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    // Seed: one file node + one function node
    db.run(`INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, structural_fp, dependency_fp, extra)
            VALUES (@id, @type, @label, @file_path, 1, 0, 'javascript', 1.0, '', '', '{}')`,
           { id: 'filenode-1', type: 'File', label: 'auth.ts', file_path: 'src/auth/auth.ts' });
    db.run(`INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, structural_fp, dependency_fp, extra)
            VALUES (@id, @type, @label, @file_path, 1, 0, 'javascript', 1.0, '', '', '{}')`,
           { id: 'symnode-1', type: 'Function', label: 'authenticate', file_path: 'src/auth/auth.ts' });
    await writeFile(join(repoRoot, '.aify-graph', 'functionality.json'), JSON.stringify({
      version: '0.1',
      features: [{
        id: 'auth',
        label: 'Authentication',
        description: 'User login',
        anchors: { symbols: ['authenticate'], files: ['src/auth/*'] },
        source: 'user',
      }],
    }));
    const started = await startDashboard({ db, port: 0, repoRoot });
    url = started.url;
    server = started.server;
  });

  afterEach(async () => {
    if (server) server.close();
    if (db) db.close();
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('feature→file anchor edges use code:${id} endpoint format', async () => {
    const r = await fetch(url + '/api/graph-multilayer');
    const payload = await r.json();
    // Find feature→anchor edges
    const anchorEdges = payload.edges.filter(e => e.relation === 'ANCHORS');
    expect(anchorEdges.length).toBeGreaterThan(0);
    // Every anchor edge's target must use code: prefix, NOT file: prefix
    for (const e of anchorEdges) {
      expect(e.target).toMatch(/^code:/);
      expect(e.target).not.toMatch(/^file:/);
    }
  });

  it('emitted cross-layer edges resolve against emitted code-layer nodes (no orphans)', async () => {
    const r = await fetch(url + '/api/graph-multilayer');
    const payload = await r.json();
    const nodeIds = new Set(payload.nodes.map(n => n.id));
    // Every cross-layer edge endpoint must be an existing node id — otherwise
    // the frontend would filter it out (the original bug).
    const crossEdges = payload.edges.filter(e => e.edge_class === 'cross-layer');
    expect(crossEdges.length).toBeGreaterThan(0);
    for (const e of crossEdges) {
      expect(nodeIds.has(e.source), `source ${e.source} must be in node set`).toBe(true);
      expect(nodeIds.has(e.target), `target ${e.target} must be in node set`).toBe(true);
    }
  });

  it('dashboard serves /, /3d (SPA fallback), and /api/graph-multilayer', async () => {
    const root = await fetch(url + '/');
    expect(root.status).toBe(200);
    const rootBody = await root.text();
    expect(rootBody).toMatch(/cytoscape/);

    const threeD = await fetch(url + '/3d');
    expect(threeD.status).toBe(200);
    const threeDBody = await threeD.text();
    // SPA fallback — same content, client detects path
    expect(threeDBody).toBe(rootBody);

    const api = await fetch(url + '/api/graph-multilayer');
    expect(api.status).toBe(200);
    const apiBody = await api.json();
    expect(apiBody).toHaveProperty('nodes');
    expect(apiBody).toHaveProperty('edges');
    expect(apiBody).toHaveProperty('counts');
  });
});
