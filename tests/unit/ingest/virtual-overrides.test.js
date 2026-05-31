// P0-5 — C++ virtual-override OVERRIDDEN_BY edge synthesizer.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { upsertNode } from '../../../mcp/stdio/storage/nodes.js';
import { upsertEdge } from '../../../mcp/stdio/storage/edges.js';
import {
  synthesizeVirtualOverrides,
  OVERRIDDEN_BY_RELATION,
  VIRTUAL_OVERRIDE_EXTRACTOR,
} from '../../../mcp/stdio/ingest/frameworks/virtual_overrides.js';

let dir;
let db;

function classNode(id, label, file = `src/${label}.h`, language = 'cpp') {
  return {
    id, type: 'Class', label, file_path: file, start_line: 1, end_line: 100,
    language, confidence: 1, structural_fp: '', dependency_fp: '',
    extra: { qname: label },
  };
}

function methodNode(id, owner, label, signature, file = `src/${owner}.h`, language = 'cpp') {
  return {
    id, type: 'Method', label, file_path: file, start_line: 5, end_line: 6,
    language, confidence: 1, structural_fp: '', dependency_fp: '',
    extra: { qname: `${owner}.${label}`, signature, parent_class: owner },
  };
}

function contains(classId, methodId) {
  return {
    from_id: classId, to_id: methodId, relation: 'CONTAINS',
    source_file: 'src/x.h', source_line: 1, confidence: 1,
    provenance: 'EXTRACTED', extractor: 'cpp',
  };
}

function extendsEdge(derivedId, baseId, relation = 'EXTENDS') {
  return {
    from_id: derivedId, to_id: baseId, relation,
    source_file: 'src/x.h', source_line: 1, confidence: 1,
    provenance: 'EXTRACTED', extractor: 'cpp',
  };
}

function overrideEdges(database) {
  return database.all(
    `SELECT * FROM edges WHERE relation = $rel`,
    { rel: OVERRIDDEN_BY_RELATION },
  );
}

describe('synthesizeVirtualOverrides', () => {
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'apg-vover-'));
    db = openDb(join(dir, 'graph.sqlite'));
  });
  afterEach(async () => {
    try { db.close(); } catch {}
    await rm(dir, { recursive: true, force: true });
  });

  it('emits INFERRED OVERRIDDEN_BY edges base→derived for 2 derived overrides', () => {
    // Base interface with one virtual; two derived classes override it.
    upsertNode(db, classNode('base', 'IShape'));
    upsertNode(db, methodNode('base.area', 'IShape', 'area', 'double area() const'));
    upsertNode(db, classNode('d1', 'Circle'));
    upsertNode(db, methodNode('d1.area', 'Circle', 'area', 'double area() const'));
    upsertNode(db, classNode('d2', 'Square'));
    upsertNode(db, methodNode('d2.area', 'Square', 'area', 'double area() const'));

    for (const e of [
      contains('base', 'base.area'),
      contains('d1', 'd1.area'),
      contains('d2', 'd2.area'),
      extendsEdge('d1', 'base'),
      extendsEdge('d2', 'base'),
    ]) upsertEdge(db, e);

    const stats = synthesizeVirtualOverrides(db, { upsertEdge });
    expect(stats.edges).toBe(2);
    expect(stats.basesWithOverrides).toBe(1);

    const edges = overrideEdges(db);
    expect(edges).toHaveLength(2);
    // All edges go FROM the base method (so traversal from base reaches overrides).
    expect(edges.every((e) => e.from_id === 'base.area')).toBe(true);
    expect(edges.map((e) => e.to_id).sort()).toEqual(['d1.area', 'd2.area']);
    // INFERRED provenance, never LSP_VERIFIED, low confidence, synthesizer tag.
    expect(edges.every((e) => e.provenance === 'INFERRED')).toBe(true);
    expect(edges.every((e) => e.provenance !== 'LSP_VERIFIED')).toBe(true);
    expect(edges.every((e) => e.confidence === 0.7)).toBe(true);
    expect(edges.every((e) => e.extractor === VIRTUAL_OVERRIDE_EXTRACTOR)).toBe(true);
    // source_file empty so per-file reindex deletes never reap it.
    expect(edges.every((e) => e.source_file === '')).toBe(true);
  });

  it('matches via signature/arity (does not link a same-name different-arity method)', () => {
    upsertNode(db, classNode('base', 'IBus'));
    upsertNode(db, methodNode('base.send', 'IBus', 'send', 'void send(int channel)'));
    upsertNode(db, classNode('d1', 'RealBus'));
    // Correct override: same name + arity 1.
    upsertNode(db, methodNode('d1.send', 'RealBus', 'send', 'void send(int ch)'));
    // Decoy: same name but arity 2 — NOT an override of the arity-1 base.
    upsertNode(db, classNode('d2', 'DecoyBus'));
    upsertNode(db, methodNode('d2.send', 'DecoyBus', 'send', 'void send(int a, int b)'));

    for (const e of [
      contains('base', 'base.send'),
      contains('d1', 'd1.send'),
      contains('d2', 'd2.send'),
      extendsEdge('d1', 'base'),
      extendsEdge('d2', 'base'),
    ]) upsertEdge(db, e);

    synthesizeVirtualOverrides(db, { upsertEdge });
    const edges = overrideEdges(db);
    // Only the arity-matching override is linked.
    expect(edges.map((e) => e.to_id)).toEqual(['d1.send']);
  });

  it('falls back to name match when a signature is unavailable', () => {
    upsertNode(db, classNode('base', 'IThing'));
    upsertNode(db, methodNode('base.tick', 'IThing', 'tick', '')); // no signature
    upsertNode(db, classNode('d1', 'RealThing'));
    upsertNode(db, methodNode('d1.tick', 'RealThing', 'tick', '')); // no signature

    for (const e of [
      contains('base', 'base.tick'),
      contains('d1', 'd1.tick'),
      extendsEdge('d1', 'base'),
    ]) upsertEdge(db, e);

    synthesizeVirtualOverrides(db, { upsertEdge });
    const edges = overrideEdges(db);
    expect(edges.map((e) => e.to_id)).toEqual(['d1.tick']);
  });

  it('does not fabricate when the base method is missing (derived-only method)', () => {
    upsertNode(db, classNode('base', 'IShape'));
    upsertNode(db, methodNode('base.area', 'IShape', 'area', 'double area() const'));
    upsertNode(db, classNode('d1', 'Circle'));
    upsertNode(db, methodNode('d1.area', 'Circle', 'area', 'double area() const'));
    // Derived-only method with NO base counterpart — must not be linked.
    upsertNode(db, methodNode('d1.radius', 'Circle', 'radius', 'double radius() const'));

    for (const e of [
      contains('base', 'base.area'),
      contains('d1', 'd1.area'),
      contains('d1', 'd1.radius'),
      extendsEdge('d1', 'base'),
    ]) upsertEdge(db, e);

    synthesizeVirtualOverrides(db, { upsertEdge });
    const edges = overrideEdges(db);
    // Only area is linked; radius (no base) is not fabricated.
    expect(edges.map((e) => e.to_id)).toEqual(['d1.area']);
  });

  it('caps overrides per base method and reports the cap', () => {
    upsertNode(db, classNode('base', 'IPlugin'));
    upsertNode(db, methodNode('base.run', 'IPlugin', 'run', 'void run()'));
    upsertEdge(db, contains('base', 'base.run'));

    // 60 derived classes all overriding run() — cap is 50.
    for (let i = 0; i < 60; i += 1) {
      const cid = `d${i}`;
      const mid = `d${i}.run`;
      upsertNode(db, classNode(cid, `Plugin${i}`));
      upsertNode(db, methodNode(mid, `Plugin${i}`, 'run', 'void run()'));
      upsertEdge(db, contains(cid, mid));
      upsertEdge(db, extendsEdge(cid, 'base'));
    }

    const stats = synthesizeVirtualOverrides(db, { upsertEdge });
    expect(stats.edges).toBe(50);
    expect(stats.cappedBaseMethods).toBe(1);
    expect(overrideEdges(db)).toHaveLength(50);
  });

  it('follows the inheritance chain transitively (grandparent virtual)', () => {
    upsertNode(db, classNode('gp', 'IBase'));
    upsertNode(db, methodNode('gp.exec', 'IBase', 'exec', 'void exec()'));
    upsertNode(db, classNode('mid', 'MidBase'));   // mid does NOT redeclare exec
    upsertNode(db, classNode('leaf', 'LeafImpl'));
    upsertNode(db, methodNode('leaf.exec', 'LeafImpl', 'exec', 'void exec()'));

    for (const e of [
      contains('gp', 'gp.exec'),
      contains('leaf', 'leaf.exec'),
      extendsEdge('mid', 'gp'),
      extendsEdge('leaf', 'mid'),
    ]) upsertEdge(db, e);

    synthesizeVirtualOverrides(db, { upsertEdge });
    const edges = overrideEdges(db);
    // leaf.exec overrides the grandparent gp.exec through the chain.
    expect(edges).toHaveLength(1);
    expect(edges[0].from_id).toBe('gp.exec');
    expect(edges[0].to_id).toBe('leaf.exec');
  });

  it('handles IMPLEMENTS edges (interface) the same as EXTENDS', () => {
    upsertNode(db, classNode('iface', 'IListener'));
    upsertNode(db, methodNode('iface.onEvent', 'IListener', 'onEvent', 'void onEvent()'));
    upsertNode(db, classNode('impl', 'Listener'));
    upsertNode(db, methodNode('impl.onEvent', 'Listener', 'onEvent', 'void onEvent()'));

    for (const e of [
      contains('iface', 'iface.onEvent'),
      contains('impl', 'impl.onEvent'),
      extendsEdge('impl', 'iface', 'IMPLEMENTS'),
    ]) upsertEdge(db, e);

    synthesizeVirtualOverrides(db, { upsertEdge });
    expect(overrideEdges(db).map((e) => e.to_id)).toEqual(['impl.onEvent']);
  });

  it('language-gates to C-family (skips a non-cpp derived class)', () => {
    upsertNode(db, classNode('base', 'IShape', 'src/IShape.ts', 'typescript'));
    upsertNode(db, methodNode('base.area', 'IShape', 'area', 'area()', 'src/IShape.ts', 'typescript'));
    upsertNode(db, classNode('d1', 'Circle', 'src/Circle.ts', 'typescript'));
    upsertNode(db, methodNode('d1.area', 'Circle', 'area', 'area()', 'src/Circle.ts', 'typescript'));

    for (const e of [
      contains('base', 'base.area'),
      contains('d1', 'd1.area'),
      extendsEdge('d1', 'base'),
    ]) upsertEdge(db, e);

    synthesizeVirtualOverrides(db, { upsertEdge });
    expect(overrideEdges(db)).toHaveLength(0);
  });

  it('is idempotent and clears stale overrides on re-run', () => {
    upsertNode(db, classNode('base', 'IShape'));
    upsertNode(db, methodNode('base.area', 'IShape', 'area', 'double area() const'));
    upsertNode(db, classNode('d1', 'Circle'));
    upsertNode(db, methodNode('d1.area', 'Circle', 'area', 'double area() const'));
    for (const e of [
      contains('base', 'base.area'),
      contains('d1', 'd1.area'),
      extendsEdge('d1', 'base'),
    ]) upsertEdge(db, e);

    synthesizeVirtualOverrides(db, { upsertEdge });
    expect(overrideEdges(db)).toHaveLength(1);
    // Re-run: still exactly one (INSERT OR IGNORE + pre-clear, no duplicates).
    synthesizeVirtualOverrides(db, { upsertEdge });
    expect(overrideEdges(db)).toHaveLength(1);
  });
});
