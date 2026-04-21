// Provenance surfacing for graph_pull (relations layer) and graph_path.
// Complements provenance-surface.test.js which covers impact/callers/
// callees/neighbors. These two verbs render differently (JSON tree vs
// indented path), so they need dedicated assertions.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { upsertNode } from '../../../mcp/stdio/storage/nodes.js';
import { upsertEdge } from '../../../mcp/stdio/storage/edges.js';
import { graphPull } from '../../../mcp/stdio/query/verbs/pull.js';
import { graphPath } from '../../../mcp/stdio/query/verbs/path.js';

describe('provenance — graph_pull + graph_path surface it', () => {
  let repoRoot;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-prov-pull-path-'));
    const run = (...args) => execFileSync('git', ['-C', repoRoot, ...args], { stdio: 'ignore' });
    run('init', '-q');
    run('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init');
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
      upsertNode(db, node('fn:alpha', 'alpha', 'src/a.js'));
      upsertNode(db, node('fn:beta', 'beta', 'src/b.js'));
      upsertNode(db, node('fn:gamma', 'gamma', 'src/c.js'));

      upsertEdge(db, {
        from_id: 'fn:alpha', to_id: 'fn:beta', relation: 'CALLS',
        source_file: 'src/a.js', source_line: 10, confidence: 0.8,
        provenance: 'INFERRED', extractor: 'javascript',
      });
      upsertEdge(db, {
        from_id: 'fn:beta', to_id: 'fn:gamma', relation: 'CALLS',
        source_file: 'src/b.js', source_line: 5, confidence: 0.6,
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

  it('graph_pull relations layer includes provenance on symbol callers/callees', async () => {
    const out = await graphPull({ repoRoot, node: 'beta', layers: ['relations'] });
    const parsed = JSON.parse(out);
    const callers = parsed.layers.relations.callers.items;
    const callees = parsed.layers.relations.callees.items;
    expect(callers.some(c => c.provenance === 'INFERRED')).toBe(true);
    expect(callees.some(c => c.provenance === 'AMBIGUOUS')).toBe(true);
  });

  it('graph_path rendered output tags non-EXTRACTED provenance on child rows', async () => {
    const out = await graphPath({ repoRoot, symbol: 'alpha', direction: 'out', depth: 3 });
    expect(typeof out).toBe('string');
    expect(out).toMatch(/prov=INFERRED|prov=AMBIGUOUS/);
  });
});
