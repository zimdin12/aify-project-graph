// Class-qualified symbol lookup regression.
//
// Context: echoes manager's 2026-04-21 CC lean-half 2×2 bench measured
// 0-of-5 useful graph calls — every failure was a qualified C++ method
// (`GpuSimFramework::setGravAxis`, `LodCascadeGenerator::generateLodChunks`,
// `LodCascadeBuffer::allocateSlot`, etc.). Labels are stored as the bare
// identifier; verbs that exact-match on `label` returned NO MATCH.
//
// resolveSymbol() now strips the parent on fallback and disambiguates by
// extra.qname, so the same query shape succeeds.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { upsertNode } from '../../../mcp/stdio/storage/nodes.js';
import {
  resolveSymbol,
  splitQualifiedSymbol,
} from '../../../mcp/stdio/query/verbs/symbol_lookup.js';

describe('resolveSymbol — class-qualified C++ / dotted symbols', () => {
  let graphDir;
  let db;

  beforeEach(async () => {
    graphDir = await mkdtemp(join(tmpdir(), 'apg-qname-'));
    db = openDb(join(graphDir, 'graph.sqlite'));

    const mk = (id, label, type, parentQ) => ({
      id, type, label, file_path: `src/${label.toLowerCase()}.cpp`,
      start_line: 1, end_line: 1, language: 'cpp', confidence: 1,
      structural_fp: '', dependency_fp: '',
      extra: parentQ ? { qname: `${parentQ}.${label}` } : {},
    });
    upsertNode(db, mk('m:gpu-set', 'setGravAxis', 'Method', 'GpuSimFramework'));
    upsertNode(db, mk('m:other-set', 'setGravAxis', 'Method', 'OtherClass'));
    upsertNode(db, mk('m:alloc', 'allocateSlot', 'Method', 'LodCascadeBuffer'));
    upsertNode(db, mk('f:free', 'freeFunction', 'Function', null));
  });

  afterEach(async () => {
    try { db.close(); } catch {}
    try { await rm(graphDir, { recursive: true, force: true }); } catch {}
  });

  it('splits C++ `A::B::method` keeping the rightmost separator', () => {
    expect(splitQualifiedSymbol('A::B::method')).toEqual({ parent: 'A::B', name: 'method' });
  });

  it('splits dotted `Module.Class.method`', () => {
    expect(splitQualifiedSymbol('Module.Class.method')).toEqual({ parent: 'Module.Class', name: 'method' });
  });

  it('bare name matches directly (exact path)', () => {
    const rows = resolveSymbol(db, 'freeFunction');
    expect(rows.map(r => r.id)).toContain('f:free');
  });

  it('C++ `Class::method` falls back to bare name match', () => {
    const rows = resolveSymbol(db, 'LodCascadeBuffer::allocateSlot');
    expect(rows.map(r => r.id)).toContain('m:alloc');
  });

  it('disambiguates by parent class when multiple bare matches exist', () => {
    const rows = resolveSymbol(db, 'GpuSimFramework::setGravAxis');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('m:gpu-set');
  });

  it('falls back to all bare matches when the parent class does not appear in any qname', () => {
    const rows = resolveSymbol(db, 'UnknownParent::setGravAxis');
    // Both bare-name rows returned; caller picks via selectBestRoot or similar.
    expect(rows.map(r => r.id).sort()).toEqual(['m:gpu-set', 'm:other-set']);
  });

  it('returns empty on true non-match', () => {
    const rows = resolveSymbol(db, 'doesNotExist');
    expect(rows).toEqual([]);
  });
});
