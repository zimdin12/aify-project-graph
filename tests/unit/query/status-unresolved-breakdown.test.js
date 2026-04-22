// Regression test for T3: graph_status returns a coarse unresolvedBy
// breakdown so echoes-PM-style repos can distinguish CALLS-heavy from
// IMPORTS-heavy unresolved shapes without speculation.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { graphStatus } from '../../../mcp/stdio/query/verbs/status.js';

describe('graph_status — unresolvedBy coarse breakdown', () => {
  let repoRoot;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-status-'));
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
  });

  afterEach(async () => {
    if (repoRoot) {
      try { await rm(repoRoot, { recursive: true, force: true }); } catch {}
    }
  });

  it('groups unresolved refs by relation and language', async () => {
    const manifest = {
      commit: 'abc123',
      indexedAt: new Date().toISOString(),
      nodes: 100,
      edges: 200,
      schemaVersion: 4,
      extractorVersion: '0.1.0',
      status: 'ok',
      dirtyFiles: [],
      dirtyEdges: [
        { relation: 'CALLS', extractor: 'javascript' },
        { relation: 'CALLS', extractor: 'javascript' },
        { relation: 'CALLS', extractor: 'python' },
        { relation: 'IMPORTS', extractor: 'javascript' },
        { relation: 'REFERENCES', extractor: 'cpp' },
      ],
      dirtyEdgeCount: 5,
      trustDirtyEdgeCount: 4,
    };
    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify(manifest));

    const status = await graphStatus({ repoRoot });
    expect(status.unresolvedBy.total).toBe(5);
    expect(status.trustUnresolvedEdges).toBe(4);
    expect(status.unresolvedBy.byRelation).toEqual({ CALLS: 3, IMPORTS: 1, REFERENCES: 1 });
    expect(status.unresolvedBy.byLanguage).toEqual({ javascript: 3, python: 1, cpp: 1 });
  });

  it('returns zero-breakdown when no unresolved refs', async () => {
    const manifest = {
      commit: 'abc123',
      indexedAt: new Date().toISOString(),
      nodes: 10, edges: 10, schemaVersion: 4, extractorVersion: '0.1.0',
      status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
    };
    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify(manifest));

    const status = await graphStatus({ repoRoot });
    expect(status.unresolvedBy).toEqual({ total: 0, sample_size: 0, byRelation: {}, byLanguage: {} });
  });

  it('flags sampling when total refs reach the manifest cap (500)', async () => {
    const dirtyEdges = Array.from({ length: 500 }, (_, i) => ({
      relation: i % 2 ? 'CALLS' : 'IMPORTS',
      extractor: 'javascript',
    }));
    const manifest = {
      commit: 'abc123',
      indexedAt: new Date().toISOString(),
      nodes: 10, edges: 10, schemaVersion: 4, extractorVersion: '0.1.0',
      status: 'ok', dirtyFiles: [], dirtyEdges, dirtyEdgeCount: 9999,
    };
    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify(manifest));

    const status = await graphStatus({ repoRoot });
    expect(status.unresolvedBy.note).toMatch(/sampled/);
  });
});
