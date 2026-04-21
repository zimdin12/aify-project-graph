import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { upsertNode, getNode, deleteNode, getNodesByFile }
  from '../../../mcp/stdio/storage/nodes.js';
import { upsertEdge, listEdges, deleteEdgesFrom, deleteEdgesTo, deleteEdgesByFile }
  from '../../../mcp/stdio/storage/edges.js';

describe('db wrapper', () => {
  let dir, db;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'apg-crud-'));
    db = openDb(join(dir, 'graph.sqlite'));
  });

  afterEach(() => {
    db.close();
  });

  it('opens a database and schema is created', () => {
    const tables = db.all(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).map(r => r.name);
    expect(tables).toContain('nodes');
    expect(tables).toContain('edges');
  });
});

describe('node CRUD', () => {
  let dir, db;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'apg-nodes-'));
    db = openDb(join(dir, 'graph.sqlite'));
  });

  afterEach(() => {
    db.close();
  });

  it('upsert + get node', () => {
    upsertNode(db, {
      id: 'fn:foo', type: 'Function', label: 'foo',
      file_path: 'src/a.py', start_line: 1, end_line: 10,
      language: 'python', confidence: 1.0,
      structural_fp: 's1', dependency_fp: 'd1',
    });
    const back = getNode(db, 'fn:foo');
    expect(back.label).toBe('foo');
    expect(back.type).toBe('Function');
    expect(back.structural_fp).toBe('s1');
  });

  it('upsert replaces existing node', () => {
    const base = {
      id: 'fn:foo', type: 'Function', label: 'foo',
      file_path: 'src/a.py', start_line: 1, end_line: 10,
      language: 'python', confidence: 1.0,
      structural_fp: 's1', dependency_fp: 'd1',
    };
    upsertNode(db, base);
    upsertNode(db, { ...base, structural_fp: 's2' });
    const back = getNode(db, 'fn:foo');
    expect(back.structural_fp).toBe('s2');
  });

  it('deleteNode removes the node', () => {
    upsertNode(db, {
      id: 'fn:foo', type: 'Function', label: 'foo',
      file_path: 'src/a.py', start_line: 1, end_line: 10,
      language: 'python', confidence: 1.0,
      structural_fp: 's', dependency_fp: 'd',
    });
    deleteNode(db, 'fn:foo');
    expect(getNode(db, 'fn:foo')).toBeUndefined();
  });

  it('getNodesByFile returns all nodes in a file', () => {
    upsertNode(db, { id: 'a', type: 'Function', label: 'a', file_path: 'x.py', start_line: 1, end_line: 1, language: 'python', confidence: 1, structural_fp: '', dependency_fp: '' });
    upsertNode(db, { id: 'b', type: 'Class', label: 'b', file_path: 'x.py', start_line: 2, end_line: 5, language: 'python', confidence: 1, structural_fp: '', dependency_fp: '' });
    upsertNode(db, { id: 'c', type: 'Function', label: 'c', file_path: 'y.py', start_line: 1, end_line: 1, language: 'python', confidence: 1, structural_fp: '', dependency_fp: '' });
    const nodes = getNodesByFile(db, 'x.py');
    expect(nodes.length).toBe(2);
    expect(nodes.map(n => n.id).sort()).toEqual(['a', 'b']);
  });
});

describe('edge CRUD', () => {
  let dir, db;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'apg-edges-'));
    db = openDb(join(dir, 'graph.sqlite'));
    upsertNode(db, { id: 'a', type: 'Function', label: 'a', file_path: 'x.py', start_line: 1, end_line: 1, language: 'python', confidence: 1, structural_fp: '', dependency_fp: '' });
    upsertNode(db, { id: 'b', type: 'Function', label: 'b', file_path: 'x.py', start_line: 5, end_line: 8, language: 'python', confidence: 1, structural_fp: '', dependency_fp: '' });
    upsertNode(db, { id: 'c', type: 'Function', label: 'c', file_path: 'y.py', start_line: 1, end_line: 3, language: 'python', confidence: 1, structural_fp: '', dependency_fp: '' });
  });

  afterEach(() => {
    db.close();
  });

  it('upsert + list edges', () => {
    upsertEdge(db, {
      from_id: 'a', to_id: 'b', relation: 'CALLS',
      source_file: 'x.py', source_line: 3, confidence: 0.9, extractor: 'python',
    });
    const edges = listEdges(db, { from_id: 'a' });
    expect(edges.length).toBe(1);
    expect(edges[0].to_id).toBe('b');
    expect(edges[0].relation).toBe('CALLS');
    expect(edges[0].provenance).toBe('EXTRACTED');
  });

  it('stores explicit provenance when provided', () => {
    upsertEdge(db, {
      from_id: 'a', to_id: 'b', relation: 'PASSES_THROUGH',
      source_file: 'x.py', source_line: 3, confidence: 0.72, provenance: 'INFERRED', extractor: 'laravel',
    });
    const edges = listEdges(db, { from_id: 'a' });
    expect(edges[0].provenance).toBe('INFERRED');
  });

  it('listEdges filters by relation', () => {
    upsertEdge(db, { from_id: 'a', to_id: 'b', relation: 'CALLS', source_file: 'x.py', source_line: 3, confidence: 0.9, extractor: 'generic' });
    upsertEdge(db, { from_id: 'a', to_id: 'c', relation: 'IMPORTS', source_file: 'x.py', source_line: 1, confidence: 1.0, extractor: 'generic' });
    const calls = listEdges(db, { from_id: 'a', relation: 'CALLS' });
    expect(calls.length).toBe(1);
    expect(calls[0].to_id).toBe('b');
  });

  it('deleteEdgesFrom removes outgoing edges', () => {
    upsertEdge(db, { from_id: 'a', to_id: 'b', relation: 'CALLS', source_file: 'x.py', source_line: 3, confidence: 0.9, extractor: 'generic' });
    deleteEdgesFrom(db, 'a');
    expect(listEdges(db, { from_id: 'a' }).length).toBe(0);
  });

  it('deleteEdgesTo removes incoming edges', () => {
    upsertEdge(db, { from_id: 'a', to_id: 'b', relation: 'CALLS', source_file: 'x.py', source_line: 3, confidence: 0.9, extractor: 'generic' });
    deleteEdgesTo(db, 'b');
    expect(listEdges(db, { to_id: 'b' }).length).toBe(0);
  });

  it('deleteEdgesByFile removes all edges sourced from a file', () => {
    upsertEdge(db, { from_id: 'a', to_id: 'b', relation: 'CALLS', source_file: 'x.py', source_line: 3, confidence: 0.9, extractor: 'generic' });
    upsertEdge(db, { from_id: 'c', to_id: 'a', relation: 'CALLS', source_file: 'y.py', source_line: 2, confidence: 0.9, extractor: 'generic' });
    deleteEdgesByFile(db, 'x.py');
    expect(listEdges(db, { source_file: 'x.py' }).length).toBe(0);
    expect(listEdges(db, { source_file: 'y.py' }).length).toBe(1);
  });
});
