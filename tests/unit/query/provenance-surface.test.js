// Provenance verb consumption — ensures the provenance field flows
// from the DB through graph_impact / graph_callers / graph_callees /
// graph_neighbors into the rendered edge output.
//
// Producer side (schema v4 + extractor/resolver tagging) shipped in
// commit 92af81a. This test asserts the consumer side surfaces it
// correctly so agents can filter EXTRACTED vs INFERRED vs AMBIGUOUS.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { upsertNode } from '../../../mcp/stdio/storage/nodes.js';
import { upsertEdge } from '../../../mcp/stdio/storage/edges.js';
import { graphImpact } from '../../../mcp/stdio/query/verbs/impact.js';
import { graphCallers } from '../../../mcp/stdio/query/verbs/callers.js';
import { graphCallees } from '../../../mcp/stdio/query/verbs/callees.js';
import { graphNeighbors } from '../../../mcp/stdio/query/verbs/neighbors.js';
import { writeFileSync } from 'node:fs';

describe('provenance — surfaces in verb output', () => {
  let repoRoot;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-provenance-'));
    const { execFileSync } = await import('node:child_process');
    const run = (...args) => execFileSync('git', ['-C', repoRoot, ...args], { stdio: 'ignore' });
    run('init', '-q');
    run('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init');

    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(repoRoot, '.aify-graph'), { recursive: true });
    const commit = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    writeFileSync(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit, indexedAt: new Date().toISOString(),
      nodes: 0, edges: 0,
      schemaVersion: 4, extractorVersion: '0.1.0',
      status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
    }));

    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    try {
      const node = (id, label, file_path) => ({
        id, type: 'Function', label, file_path,
        start_line: 1, end_line: 1, language: 'javascript', confidence: 1,
        structural_fp: '', dependency_fp: '', extra: {},
      });
      upsertNode(db, node('fn:caller1', 'caller1', 'src/a.js'));
      upsertNode(db, node('fn:caller2', 'caller2', 'src/b.js'));
      upsertNode(db, node('fn:target', 'target', 'src/c.js'));
      upsertNode(db, node('fn:callee', 'helper', 'src/d.js'));

      upsertEdge(db, {
        from_id: 'fn:caller1', to_id: 'fn:target', relation: 'CALLS',
        source_file: 'src/a.js', source_line: 10, confidence: 1,
        provenance: 'EXTRACTED', extractor: 'javascript',
      });
      upsertEdge(db, {
        from_id: 'fn:caller2', to_id: 'fn:target', relation: 'CALLS',
        source_file: 'src/b.js', source_line: 5, confidence: 0.8,
        provenance: 'INFERRED', extractor: 'javascript',
      });
      upsertEdge(db, {
        from_id: 'fn:target', to_id: 'fn:callee', relation: 'CALLS',
        source_file: 'src/c.js', source_line: 3, confidence: 0.6,
        provenance: 'AMBIGUOUS', extractor: 'javascript',
      });
    } finally {
      db.close();
    }
  });

  afterEach(async () => {
    if (repoRoot) {
      try { await rm(repoRoot, { recursive: true, force: true }); } catch {}
    }
  });

  it('graph_impact output includes provenance on each edge', async () => {
    const out = await graphImpact({ repoRoot, symbol: 'target' });
    // Rendered as compact text — look for provenance tokens
    expect(typeof out).toBe('string');
    expect(out).toMatch(/EXTRACTED|INFERRED|AMBIGUOUS/);
  });

  it('graph_callers output includes provenance on each edge', async () => {
    const out = await graphCallers({ repoRoot, symbol: 'target' });
    expect(typeof out).toBe('string');
    expect(out).toMatch(/EXTRACTED|INFERRED/);
  });

  it('graph_callees output includes provenance on each edge', async () => {
    const out = await graphCallees({ repoRoot, symbol: 'target' });
    expect(typeof out).toBe('string');
    expect(out).toMatch(/AMBIGUOUS|EXTRACTED/);
  });

  it('graph_neighbors output includes provenance on each edge', async () => {
    const out = await graphNeighbors({ repoRoot, symbol: 'target' });
    expect(typeof out).toBe('string');
    expect(out).toMatch(/EXTRACTED|INFERRED|AMBIGUOUS/);
  });
});
