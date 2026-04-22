import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { upsertNode } from '../../../mcp/stdio/storage/nodes.js';
import { upsertEdge } from '../../../mcp/stdio/storage/edges.js';
import { detectCommunities, communitySummary } from '../../../mcp/stdio/analysis/communities.js';

function mkNode(id, type = 'Function') {
  return {
    id,
    type,
    label: id,
    file_path: 'x.py',
    start_line: 1,
    end_line: 1,
    language: 'python',
    confidence: 1,
    structural_fp: '',
    dependency_fp: '',
  };
}

function mkEdge(from, to, line = 1) {
  return {
    from_id: from,
    to_id: to,
    relation: 'CALLS',
    source_file: 'x.py',
    source_line: line,
    confidence: 1.0,
    extractor: 'test',
  };
}

function seedTwoClusterGraph(db, nodeOrder = ['a', 'b', 'c', 'd', 'e', 'f'], edgeOrder = [
  ['a', 'b'],
  ['b', 'c'],
  ['a', 'c'],
  ['d', 'e'],
  ['e', 'f'],
  ['d', 'f'],
  ['c', 'd'],
]) {
  for (const id of nodeOrder) upsertNode(db, mkNode(id));
  let line = 1;
  for (const [from, to] of edgeOrder) upsertEdge(db, mkEdge(from, to, line++));
}

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
    seedTwoClusterGraph(db);

    const result = detectCommunities(db);
    expect(result.communities).toBeGreaterThanOrEqual(1);
    expect(result.assignments.size).toBe(6);
    expect(result.assignments.get('a')).toBe(result.assignments.get('b'));
    expect(result.assignments.get('b')).toBe(result.assignments.get('c'));
    expect(result.assignments.get('d')).toBe(result.assignments.get('e'));
    expect(result.assignments.get('e')).toBe(result.assignments.get('f'));
  });

  it('communitySummary returns grouped members', () => {
    for (const id of ['a', 'b', 'c']) upsertNode(db, mkNode(id));
    upsertEdge(db, mkEdge('a', 'b', 1));
    upsertEdge(db, mkEdge('b', 'c', 2));

    detectCommunities(db);
    const summary = communitySummary(db);
    expect(summary.size).toBeGreaterThanOrEqual(1);
  });

  it('canonicalizes community ids independent of insertion order', async () => {
    seedTwoClusterGraph(db);
    const first = [...detectCommunities(db).assignments.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    const dir2 = await mkdtemp(join(tmpdir(), 'apg-comm-'));
    const db2 = openDb(join(dir2, 'graph.sqlite'));
    try {
      seedTwoClusterGraph(
        db2,
        ['f', 'e', 'd', 'c', 'b', 'a'],
        [['c', 'd'], ['d', 'f'], ['e', 'f'], ['d', 'e'], ['a', 'c'], ['b', 'c'], ['a', 'b']],
      );
      const second = [...detectCommunities(db2).assignments.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      expect(second).toEqual(first);
    } finally {
      db2.close();
      await rm(dir2, { recursive: true, force: true });
    }
  });

  it('communitySummary excludes external and structural wrapper nodes', () => {
    upsertNode(db, mkNode('join', 'External'));
    upsertNode(db, mkNode('mcp.stdio.query.renderer', 'Module'));
    upsertNode(db, mkNode('renderer.js', 'File'));
    upsertNode(db, mkNode('formatLocation'));
    upsertNode(db, mkNode('renderCompact'));
    upsertNode(db, mkNode('renderPath'));

    upsertEdge(db, mkEdge('formatLocation', 'join', 1));
    upsertEdge(db, mkEdge('renderCompact', 'join', 2));
    upsertEdge(db, mkEdge('renderPath', 'join', 3));
    upsertEdge(db, mkEdge('formatLocation', 'renderer.js', 4));
    upsertEdge(db, mkEdge('renderCompact', 'mcp.stdio.query.renderer', 5));
    upsertEdge(db, mkEdge('renderCompact', 'renderPath', 6));
    upsertEdge(db, mkEdge('renderPath', 'formatLocation', 7));

    detectCommunities(db);
    const summary = communitySummary(db);
    const members = [...summary.values()].flat();
    expect(members.length).toBeGreaterThan(0);
    expect(members.every(member => !['External', 'Module', 'File'].includes(member.type))).toBe(true);
  });
});
