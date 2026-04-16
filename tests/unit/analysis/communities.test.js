import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { upsertNode } from '../../../mcp/stdio/storage/nodes.js';
import { upsertEdge } from '../../../mcp/stdio/storage/edges.js';
import { detectCommunities, communitySummary } from '../../../mcp/stdio/analysis/communities.js';

describe('community detection', () => {
  let dir, db;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'apg-comm-'));
    db = openDb(join(dir, 'graph.sqlite'));
  });

  afterEach(() => {
    db.close();
  });

  it('detects communities on a small graph', () => {
    // Create two clusters: a↔b↔c and d↔e↔f, connected by c→d
    const mk = (id) => ({
      id, type: 'Function', label: id, file_path: 'x.py',
      start_line: 1, end_line: 1, language: 'python',
      confidence: 1, structural_fp: '', dependency_fp: '',
    });
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) upsertNode(db, mk(id));
    const edge = (from, to) => ({
      from_id: from, to_id: to, relation: 'CALLS',
      source_file: 'x.py', source_line: 1, confidence: 1.0, extractor: 'test',
    });
    // Cluster 1: a-b, b-c, a-c (dense)
    upsertEdge(db, edge('a', 'b'));
    upsertEdge(db, edge('b', 'c'));
    upsertEdge(db, edge('a', 'c'));
    // Cluster 2: d-e, e-f, d-f (dense)
    upsertEdge(db, edge('d', 'e'));
    upsertEdge(db, edge('e', 'f'));
    upsertEdge(db, edge('d', 'f'));
    // Bridge: c-d (weak link)
    upsertEdge(db, edge('c', 'd'));

    const result = detectCommunities(db);
    expect(result.communities).toBeGreaterThanOrEqual(1);
    expect(result.assignments.size).toBe(6);
  });

  it('communitySummary returns grouped members', () => {
    const mk = (id) => ({
      id, type: 'Function', label: id, file_path: 'x.py',
      start_line: 1, end_line: 1, language: 'python',
      confidence: 1, structural_fp: '', dependency_fp: '',
    });
    for (const id of ['a', 'b', 'c']) upsertNode(db, mk(id));
    upsertEdge(db, { from_id: 'a', to_id: 'b', relation: 'CALLS', source_file: 'x.py', source_line: 1, confidence: 1, extractor: 'test' });
    upsertEdge(db, { from_id: 'b', to_id: 'c', relation: 'CALLS', source_file: 'x.py', source_line: 2, confidence: 1, extractor: 'test' });

    detectCommunities(db);
    const summary = communitySummary(db);
    expect(summary.size).toBeGreaterThanOrEqual(1);
  });
});
