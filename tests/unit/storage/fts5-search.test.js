// Plan #17 A tests: FTS5 search over node labels.
// Verifies:
//   - Single-token search returns prefix-matched nodes ranked by FTS bm25.
//   - Multi-token AND search (both tokens must appear in the label).
//   - Empty / whitespace input returns [].
//   - Triggers keep the FTS index in sync on upsert + delete.
//   - Special FTS5 metachars are escaped (no parse errors on quotes, etc).
//   - Backfill picks up nodes that were already present when the FTS
//     virtual table was created.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { upsertNode, deleteNode, searchNodesFts } from '../../../mcp/stdio/storage/nodes.js';
import { ensureNodesFtsTable } from '../../../mcp/stdio/storage/schema.js';

let dbPath;
let db;

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-fts5-'));
  dbPath = path.join(dir, '.aify-graph', 'graph.sqlite');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = openDb(dbPath);
});

afterEach(() => { db?.close?.(); });

function seedNodes(nodes) {
  for (const n of nodes) {
    upsertNode(db, {
      id: n.id,
      type: n.type || 'Function',
      label: n.label,
      file_path: n.file_path || 'src/x.js',
      start_line: 1,
      end_line: 1,
      language: 'javascript'
    });
  }
}

describe('searchNodesFts (Plan #17 A)', () => {
  it('returns nodes whose label prefix-matches a single token', () => {
    seedNodes([
      { id: 'sym:auth:authenticate', label: 'authenticate' },
      { id: 'sym:user:findUser',     label: 'findUser' },
      { id: 'sym:auth:authorize',    label: 'authorize' }
    ]);
    const r = searchNodesFts(db, 'auth');
    const labels = r.map(n => n.label).sort();
    expect(labels).toContain('authenticate');
    expect(labels).toContain('authorize');
    expect(labels).not.toContain('findUser');
  });

  it('multi-token search is AND (both tokens must appear)', () => {
    seedNodes([
      { id: 'a', label: 'user authenticate handler' },
      { id: 'b', label: 'session authenticate' },
      { id: 'c', label: 'user logout' }
    ]);
    const r = searchNodesFts(db, 'user authenticate');
    const ids = r.map(n => n.id);
    expect(ids).toContain('a');
    expect(ids).not.toContain('b');
    expect(ids).not.toContain('c');
  });

  it('empty / whitespace input returns []', () => {
    seedNodes([{ id: 'a', label: 'foo' }]);
    expect(searchNodesFts(db, '')).toEqual([]);
    expect(searchNodesFts(db, '   ')).toEqual([]);
    expect(searchNodesFts(db, null)).toEqual([]);
  });

  it('upsert keeps FTS in sync (modified labels still findable, old labels gone)', () => {
    seedNodes([{ id: 'sym:x', label: 'originalName' }]);
    expect(searchNodesFts(db, 'original').map(n => n.id)).toContain('sym:x');
    upsertNode(db, { id: 'sym:x', type: 'Function', label: 'renamedName', file_path: 'src/x.js', start_line: 1, end_line: 1 });
    const orig = searchNodesFts(db, 'original').map(n => n.id);
    const renamed = searchNodesFts(db, 'renamed').map(n => n.id);
    expect(orig).not.toContain('sym:x');
    expect(renamed).toContain('sym:x');
  });

  it('delete keeps FTS in sync (removed nodes are no longer searchable)', () => {
    seedNodes([{ id: 'sym:goner', label: 'goneSoon' }]);
    expect(searchNodesFts(db, 'goneSoon').map(n => n.id)).toContain('sym:goner');
    deleteNode(db, 'sym:goner');
    expect(searchNodesFts(db, 'goneSoon').map(n => n.id)).not.toContain('sym:goner');
  });

  it('special FTS5 metachars in query do not crash (quotes escaped, prefix wildcard appended)', () => {
    seedNodes([{ id: 'a', label: 'hello' }]);
    expect(() => searchNodesFts(db, 'he"llo')).not.toThrow();
    expect(() => searchNodesFts(db, 'foo OR bar')).not.toThrow();
    expect(() => searchNodesFts(db, 'auth*')).not.toThrow();
  });

  it('respects limit', () => {
    const nodes = Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, label: `match${i}` }));
    seedNodes(nodes);
    expect(searchNodesFts(db, 'match', 10).length).toBe(10);
  });

  it('FTS5 backfill catches nodes inserted before nodes_fts existed (idempotent)', () => {
    // Drop and re-create the FTS table; backfill INSERT-SELECT should
    // repopulate it. ensureNodesFtsTable runs on every openDb.
    // Drop triggers + table so seeded inserts after this point don't
    // touch any FTS table. After re-create + backfill, the pre-existing
    // row must be searchable.
    db.exec(`
      DROP TRIGGER IF EXISTS nodes_fts_after_insert;
      DROP TRIGGER IF EXISTS nodes_fts_after_update;
      DROP TRIGGER IF EXISTS nodes_fts_after_delete;
      DROP TABLE IF EXISTS nodes_fts;
    `);
    seedNodes([{ id: 'pre', label: 'preExisting' }]);
    ensureNodesFtsTable(db);
    expect(searchNodesFts(db, 'pre').map(n => n.id)).toContain('pre');
  });
});
