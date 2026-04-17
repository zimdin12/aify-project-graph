import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSchema, SCHEMA_VERSION } from '../../../mcp/stdio/storage/schema.js';

describe('schema', () => {
  let dir, db;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'apg-schema-'));
    db = new Database(join(dir, 'graph.sqlite'));
  });

  afterEach(() => {
    db.close();
  });

  it('creates nodes and edges tables', () => {
    createSchema(db);
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all().map(r => r.name);
    expect(tables).toContain('nodes');
    expect(tables).toContain('edges');
  });

  it('is idempotent — second call does not error', () => {
    createSchema(db);
    createSchema(db);
    const count = db.prepare("SELECT count(*) AS c FROM nodes").get().c;
    expect(count).toBe(0);
  });

  it('nodes table has all expected columns', () => {
    createSchema(db);
    const cols = db.prepare("PRAGMA table_info(nodes)").all().map(r => r.name);
    expect(cols).toEqual(expect.arrayContaining([
      'id', 'type', 'label', 'file_path', 'start_line', 'end_line',
      'language', 'confidence', 'structural_fp', 'dependency_fp',
    ]));
  });

  it('edges table has all expected columns', () => {
    createSchema(db);
    const cols = db.prepare("PRAGMA table_info(edges)").all().map(r => r.name);
    expect(cols).toEqual(expect.arrayContaining([
      'from_id', 'to_id', 'relation', 'source_file', 'source_line',
      'confidence', 'extractor',
    ]));
  });

  it('creates indexes on hot query paths', () => {
    createSchema(db);
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'"
    ).all().map(r => r.name);
    expect(indexes).toEqual(expect.arrayContaining([
      'idx_nodes_label',
      'idx_nodes_qname',
      'idx_nodes_file_path',
      'idx_nodes_type',
      'idx_edges_from',
      'idx_edges_to',
      'idx_edges_relation',
    ]));
  });

  it('exports a numeric SCHEMA_VERSION', () => {
    expect(SCHEMA_VERSION).toBeTypeOf('number');
    expect(SCHEMA_VERSION).toBeGreaterThan(0);
  });
});
