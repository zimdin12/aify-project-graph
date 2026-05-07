import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../../../../mcp/stdio/storage/db.js';
import { upsertNode } from '../../../../mcp/stdio/storage/nodes.js';
import { upsertEdge } from '../../../../mcp/stdio/storage/edges.js';
import { importCodeIntelRecords } from '../../../../mcp/stdio/ingest/code-intel/importer.js';

describe('code-intel importer', () => {
  let dir;
  let db;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'apg-ci-import-'));
    db = openDb(join(dir, 'graph.sqlite'));
  });

  afterEach(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('imports symbols, include edges, call edges, and diagnostics with CODE_INTEL provenance', () => {
    const counts = importCodeIntelRecords(db, [
      { kind: 'symbol', symbol_kind: 'class', qname: 'ChunkManager', file: 'engine/voxel/ChunkManager.h', start_line: 9, language: 'cpp' },
      { kind: 'symbol', symbol_kind: 'method', qname: 'ChunkManager::setVoxel', file: 'engine/voxel/ChunkManager.cpp', start_line: 42, language: 'cpp' },
      { kind: 'call', source: { qname: 'ChunkManager::setVoxel', file: 'engine/voxel/ChunkManager.cpp', line: 42 }, target: { qname: 'VoxelStore::write', file: 'engine/voxel/VoxelStore.cpp', line: 12 }, file: 'engine/voxel/ChunkManager.cpp', start_line: 45, language: 'cpp' },
      { kind: 'include', source_file: 'engine/voxel/ChunkManager.cpp', target_file: 'engine/voxel/ChunkManager.h', start_line: 1 },
      { kind: 'diagnostic', file: 'engine/voxel/ChunkManager.cpp', start_line: 47, severity: 'warning', code: 'unused-result', message: 'ignored return value' },
    ]);

    expect(counts).toEqual({ records: 5, symbols: 2, edges: 1, includes: 1, diagnostics: 1 });
    const method = db.get(`
      SELECT type, label, file_path, json_extract(extra, '$.qname') AS qname
      FROM nodes
      WHERE json_extract(extra, '$.qname') = 'ChunkManager::setVoxel'
    `);
    expect(method).toMatchObject({ type: 'Method', label: 'setVoxel', file_path: 'engine/voxel/ChunkManager.cpp' });

    const edges = db.all(`
      SELECT relation, provenance, extractor, source_file
      FROM edges
      WHERE provenance = 'CODE_INTEL'
      ORDER BY relation
    `);
    expect(edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ relation: 'CALLS', provenance: 'CODE_INTEL' }),
      expect.objectContaining({ relation: 'DEFINES', provenance: 'CODE_INTEL' }),
      expect.objectContaining({ relation: 'HAS_DIAGNOSTIC', provenance: 'CODE_INTEL' }),
      expect.objectContaining({ relation: 'IMPORTS', provenance: 'CODE_INTEL' }),
    ]));
  });

  it('lets CODE_INTEL replace weaker duplicate extracted edges', () => {
    upsertNode(db, { id: 'a', type: 'Function', label: 'a', file_path: 'a.cpp', start_line: 1, end_line: 1 });
    upsertNode(db, { id: 'b', type: 'Function', label: 'b', file_path: 'b.cpp', start_line: 1, end_line: 1 });
    upsertEdge(db, { from_id: 'a', to_id: 'b', relation: 'CALLS', source_file: 'a.cpp', source_line: 2, confidence: 0.5, provenance: 'INFERRED', extractor: 'tree-sitter' });
    upsertEdge(db, { from_id: 'a', to_id: 'b', relation: 'CALLS', source_file: 'a.cpp', source_line: 3, confidence: 1, provenance: 'CODE_INTEL', extractor: 'clangd' });

    const edge = db.get(`SELECT source_line, confidence, provenance, extractor FROM edges WHERE from_id = 'a' AND to_id = 'b' AND relation = 'CALLS'`);
    expect(edge).toMatchObject({ source_line: 3, confidence: 1, provenance: 'CODE_INTEL', extractor: 'clangd' });
  });
});
