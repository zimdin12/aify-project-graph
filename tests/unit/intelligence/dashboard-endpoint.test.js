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
