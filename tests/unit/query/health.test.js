// graph_health aggregates existing signals (indexed state, trust,
// staleness, overlay validity) into one answer. Pure synthesis — no
// new data. Tests cover the decision branches: no-graph, fresh+clean,
// stale, weak trust, broken overlay.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { graphHealth } from '../../../mcp/stdio/query/verbs/health.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

describe('graph_health — synthesis of graph state signals', () => {
  let repoRoot;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-health-'));
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
  });

  afterEach(async () => {
    if (repoRoot) {
      try { await rm(repoRoot, { recursive: true, force: true }); } catch {}
    }
  });

  it('reports missing trust when no graph exists', async () => {
    const result = await graphHealth({ repoRoot });
    expect(result.indexed).toBe(false);
    expect(result.trust).toBe('missing');
    expect(result.summary).toMatch(/No graph/);
  });

  it('reports strong trust on a clean graph', async () => {
    // Create a minimal graph
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    db.close();

    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit: 'abc123', indexedAt: new Date().toISOString(),
      nodes: 100, edges: 200, schemaVersion: 4, extractorVersion: '0.1.0',
      status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
    }));

    const result = await graphHealth({ repoRoot });
    expect(result.indexed).toBe(true);
    expect(result.trust).toBe('strong');
    expect(result.unresolvedEdges).toBe(0);
    expect(result.summary).toMatch(/trust=strong/);
  });

  it('reports weak trust when unresolved > 2000', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    db.close();

    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit: 'abc123', indexedAt: new Date().toISOString(),
      nodes: 100, edges: 200, schemaVersion: 4, extractorVersion: '0.1.0',
      status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 5227,
    }));

    const result = await graphHealth({ repoRoot });
    expect(result.trust).toBe('weak');
    expect(result.unresolvedEdges).toBe(5227);
    expect(result.summary).toMatch(/trust=weak \(5227 unresolved\)/);
  });

  it('uses trustDirtyEdgeCount so unresolved CONTAINS noise does not force weak trust', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    db.close();

    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit: 'abc123', indexedAt: new Date().toISOString(),
      nodes: 100, edges: 200, schemaVersion: 4, extractorVersion: '0.1.0',
      status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 5227, trustDirtyEdgeCount: 600,
    }));

    const result = await graphHealth({ repoRoot });
    expect(result.trust).toBe('ok');
    expect(result.unresolvedEdges).toBe(5227);
    expect(result.trustUnresolvedEdges).toBe(600);
    expect(result.summary).toMatch(/trust=ok \(600 trust-relevant unresolved, 5227 total\)/);
  });

  it('reports broken overlay state when functionality.json has broken anchors', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    db.close();

    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit: 'abc123', indexedAt: new Date().toISOString(),
      nodes: 0, edges: 0, schemaVersion: 4, extractorVersion: '0.1.0',
      status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
    }));
    await writeFile(join(repoRoot, '.aify-graph', 'functionality.json'), JSON.stringify({
      features: [{
        id: 'broken-feature',
        anchors: { symbols: ['ThisDoesNotExist'], files: ['nope/nonexistent.ts'] },
      }],
    }));

    const result = await graphHealth({ repoRoot });
    expect(result.overlay.present).toBe(true);
    expect(result.overlay.broken).toBe(1);
    expect(result.overlay.sample[0].id).toBe('broken-feature');
    expect(result.summary).toMatch(/overlay=broken 1\/1/);
  });

  it('summary is one line across all axes', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    db.close();
    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit: 'abc123', indexedAt: new Date().toISOString(),
      nodes: 10, edges: 20, schemaVersion: 4, extractorVersion: '0.1.0',
      status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 100,
    }));

    const result = await graphHealth({ repoRoot });
    expect(result.summary.split('\n').length).toBe(1);
    expect(result.summary).toContain('·');
    expect(result.summary).toMatch(/nodes=/);
    expect(result.summary).toMatch(/trust=/);
    expect(result.summary).toMatch(/fresh|stale/);
    expect(result.summary).toMatch(/overlay=/);
  });
});
