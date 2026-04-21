import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { graphHealth } from '../../../mcp/stdio/query/verbs/health.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

describe('graph_health — brief stale detection', () => {
  let repoRoot;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-health-brief-stale-'));
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });

    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    db.close();
  });

  afterEach(async () => {
    if (repoRoot) {
      try { await rm(repoRoot, { recursive: true, force: true }); } catch {}
    }
  });

  it('flags briefStaleVsManifest when brief.json graph_indexed_at lags manifest.indexedAt', async () => {
    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit: 'abc1234',
      indexedAt: '2026-04-21T19:17:53.115Z',
      nodes: 100,
      edges: 200,
      schemaVersion: 3,
      extractorVersion: '0.1.0',
      status: 'ok',
      dirtyFiles: [],
      dirtyEdges: [],
      dirtyEdgeCount: 42,
    }));

    await writeFile(join(repoRoot, '.aify-graph', 'brief.json'), JSON.stringify({
      graph_indexed_at: '1900-01-01T00:00:00.000Z',
      repo: {
        trust: {
          level: 'strong',
          unresolved_edges: 0,
          issues: [],
        },
      },
    }));

    const result = await graphHealth({ repoRoot });
    expect(result.briefStaleVsManifest).toBe(true);
    expect(result.summary).toContain('brief-stale: regenerate with graph-brief.mjs');
  });

  it('swallows malformed brief.json during stale check and still returns health', async () => {
    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit: 'abc1234',
      indexedAt: '2026-04-21T19:17:53.115Z',
      nodes: 100,
      edges: 200,
      schemaVersion: 3,
      extractorVersion: '0.1.0',
      status: 'ok',
      dirtyFiles: [],
      dirtyEdges: [],
      dirtyEdgeCount: 42,
    }));

    await writeFile(join(repoRoot, '.aify-graph', 'brief.json'), '{not valid json');

    const result = await graphHealth({ repoRoot });
    expect(result.indexed).toBe(true);
    expect(result.trust).toBe('strong');
    expect(result.briefStaleVsManifest).toBe(false);
    expect(result.summary).not.toContain('brief-stale');
  });
});
