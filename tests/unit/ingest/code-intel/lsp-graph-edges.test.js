import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../../../../mcp/stdio/storage/db.js';
import { upsertNode } from '../../../../mcp/stdio/storage/nodes.js';
import { upsertEdge } from '../../../../mcp/stdio/storage/edges.js';
import { importCodeIntel } from '../../../../mcp/stdio/ingest/code-intel/importer.js';

// L2a: clangd v0.2 collection records must become real LSP_VERIFIED graph edges
// so graph_callers / graph_impact / graph_neighbors can see clangd ground truth.

const FILE = 'src/widget.cpp';
const CALLEE_SYMBOL_ID = 'c:cpp:src/widget.cpp:30:1';

function calleeSymbolRecord(collectionId) {
  return {
    schema_version: '0.2',
    collectionId,
    kind: 'symbol',
    language: 'cpp',
    symbolId: CALLEE_SYMBOL_ID,
    qname: 'callee_fn',
    name: 'callee_fn',
    file: FILE,
    range: { start: { line: 30, col: 1 }, end: { line: 35, col: 1 } },
    confidence: 'high',
    provenance: 'cpp-clangd@0.1.0',
    result_state: 'found',
  };
}

function referenceRecord(collectionId, { symbolId = CALLEE_SYMBOL_ID, line = 15, file = FILE } = {}) {
  return {
    schema_version: '0.2',
    collectionId,
    kind: 'reference',
    language: 'cpp',
    symbolId,
    qname: 'callee_fn',
    file,
    range: { start: { line, col: 5 }, end: { line, col: 13 } },
    context: 'call_expr',
    confidence: 'high',
    provenance: 'cpp-clangd@0.1.0',
    result_state: 'found',
  };
}

function envelope({ collectionId = 'ci-2026-05-31-aaaa', compileDbHash = 'hash0001abcd', records }) {
  return {
    schema_version: '0.2',
    collectionId,
    provider: 'cpp-clangd',
    providerVersion: '0.1.0',
    projectRoot: '/repo',
    session: {
      collectedAt: '2026-05-31T00:00:00Z',
      freshnessBasis: 'compile_db_hash',
      freshnessValue: compileDbHash,
      compileDbHash,
    },
    operations: {
      symbols: { status: 'ok', count: 1 },
      references: { status: 'ok', count: 1 },
    },
    status: 'ok',
    records,
  };
}

describe('L2a: clangd v0.2 → LSP_VERIFIED graph edges', () => {
  let dir;
  let db;
  let tmpFile;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'apg-lsp-edges-'));
    db = openDb(join(dir, 'graph.sqlite'));
    tmpFile = join(dir, 'collection.json');
    // Pre-seed two tree-sitter symbol nodes in one file.
    upsertNode(db, {
      id: 'ts:caller_fn', type: 'Function', label: 'caller_fn',
      file_path: FILE, start_line: 10, end_line: 20, language: 'cpp',
    });
    upsertNode(db, {
      id: 'ts:callee_fn', type: 'Function', label: 'callee_fn',
      file_path: FILE, start_line: 30, end_line: 35, language: 'cpp',
    });
  });

  afterEach(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  function importEnvelope(env) {
    fs.writeFileSync(tmpFile, JSON.stringify(env));
    return importCodeIntel(tmpFile, db);
  }

  it('synthesizes a caller_fn → callee_fn CALLS edge with LSP_VERIFIED provenance', () => {
    const stats = importEnvelope(envelope({
      records: [calleeSymbolRecord('ci-1'), referenceRecord('ci-1')],
    }));

    expect(stats.schemaVersion).toBe('0.2');
    expect(stats.edgesCreated).toBe(1);

    const edge = db.get(`
      SELECT from_id, to_id, relation, provenance, extractor, source_line, confidence
      FROM edges WHERE provenance = 'LSP_VERIFIED'
    `);
    expect(edge).toMatchObject({
      from_id: 'ts:caller_fn',
      to_id: 'ts:callee_fn',
      relation: 'CALLS',
      provenance: 'LSP_VERIFIED',
      source_line: 15,
    });
    // index generation visible on the edge (first 8 chars of compileDbHash)
    expect(edge.extractor).toBe('cpp-clangd#hash0001');
    expect(edge.confidence).toBeCloseTo(0.95);
  });

  it('re-import with a different compileDbHash invalidates the old LSP edge', () => {
    importEnvelope(envelope({
      collectionId: 'ci-1', compileDbHash: 'oldhash01xx',
      records: [calleeSymbolRecord('ci-1'), referenceRecord('ci-1', { line: 15 })],
    }));
    const before = db.get(`SELECT extractor, source_line FROM edges WHERE provenance='LSP_VERIFIED'`);
    expect(before.extractor).toBe('cpp-clangd#oldhash0');
    expect(before.source_line).toBe(15);

    const stats = importEnvelope(envelope({
      collectionId: 'ci-2', compileDbHash: 'newhash99yy',
      records: [calleeSymbolRecord('ci-2'), referenceRecord('ci-2', { line: 16 })],
    }));
    expect(stats.edgesInvalidated).toBe(1);

    const all = db.all(`SELECT extractor, source_line FROM edges WHERE provenance='LSP_VERIFIED'`);
    expect(all).toHaveLength(1);
    expect(all[0].extractor).toBe('cpp-clangd#newhash9'); // old gone
    expect(all[0].source_line).toBe(16); // new present
  });

  it('skips a reference whose callee symbol is unknown (no crash, no bogus edge)', () => {
    const stats = importEnvelope(envelope({
      records: [
        calleeSymbolRecord('ci-1'),
        // reference to a symbolId that was never defined → no node map entry
        referenceRecord('ci-1', { symbolId: 'c:cpp:nowhere:1:1', line: 15 }),
      ],
    }));
    expect(stats.edgesCreated).toBe(0);
    const lsp = db.all(`SELECT * FROM edges WHERE provenance='LSP_VERIFIED'`);
    expect(lsp).toHaveLength(0);
  });

  it('skips a reference that lands inside the callee own definition range', () => {
    // ref at line 32 is inside callee_fn (30-35) → declaration, not a call
    const stats = importEnvelope(envelope({
      records: [calleeSymbolRecord('ci-1'), referenceRecord('ci-1', { line: 32 })],
    }));
    expect(stats.edgesCreated).toBe(0);
  });

  // C1 (CRITICAL) — promote-then-drop edge data-loss regression.
  //
  // Seed a real tree-sitter EXTRACTED caller_fn→callee_fn CALLS edge (the kind
  // graph_index creates). A first collection confirms it (promote → LSP_VERIFIED).
  // A SECOND complete collection (different compileDbHash) does NOT re-report it
  // (clangd index cold / ref dropped). The edge MUST still exist afterward —
  // restored to its heuristic provenance — so graph_callers still sees a caller.
  it('C1: promote-then-drop preserves the original heuristic edge (does NOT lose it)', () => {
    // 1. Seed the tree-sitter heuristic edge (only ever created at graph_index).
    upsertEdge(db, {
      from_id: 'ts:caller_fn', to_id: 'ts:callee_fn', relation: 'CALLS',
      source_file: FILE, source_line: 15, confidence: 0.5,
      provenance: 'EXTRACTED', extractor: 'tree-sitter',
    });

    // 2. collect-1: clangd confirms caller_fn→callee_fn → promotes to LSP_VERIFIED.
    importEnvelope(envelope({
      collectionId: 'ci-1', compileDbHash: 'hashAAAA1111',
      records: [calleeSymbolRecord('ci-1'), referenceRecord('ci-1', { line: 15 })],
    }));
    const afterCollect1 = db.get(
      `SELECT provenance FROM edges WHERE from_id='ts:caller_fn' AND to_id='ts:callee_fn' AND relation='CALLS'`,
    );
    expect(afterCollect1.provenance).toBe('LSP_VERIFIED'); // promoted

    // 3. collect-2: complete (status ok) but clangd does NOT report the ref
    //    (only the symbol record, no reference). Pre-fix the blanket DELETE
    //    wiped the promoted row → edge GONE. Post-fix it is restored to EXTRACTED.
    importEnvelope(envelope({
      collectionId: 'ci-2', compileDbHash: 'hashBBBB2222',
      records: [calleeSymbolRecord('ci-2')], // NO referenceRecord → ref dropped
    }));

    const surviving = db.get(
      `SELECT provenance, extractor, confidence FROM edges
        WHERE from_id='ts:caller_fn' AND to_id='ts:callee_fn' AND relation='CALLS'`,
    );
    // The edge STILL EXISTS — graph_callers would still see a caller.
    expect(surviving).toBeTruthy();
    // It was restored to its heuristic identity, not left as orphan LSP.
    expect(surviving.provenance).toBe('EXTRACTED');
    expect(surviving.extractor).toBe('tree-sitter');
    expect(surviving.confidence).toBeCloseTo(0.5);
  });

  it('C1: re-confirming a promoted edge keeps a single LSP row (no duplication / stash leak)', () => {
    upsertEdge(db, {
      from_id: 'ts:caller_fn', to_id: 'ts:callee_fn', relation: 'CALLS',
      source_file: FILE, source_line: 15, confidence: 0.5,
      provenance: 'EXTRACTED', extractor: 'tree-sitter',
    });
    importEnvelope(envelope({
      collectionId: 'ci-1', compileDbHash: 'hashAAAA1111',
      records: [calleeSymbolRecord('ci-1'), referenceRecord('ci-1', { line: 15 })],
    }));
    importEnvelope(envelope({
      collectionId: 'ci-2', compileDbHash: 'hashBBBB2222',
      records: [calleeSymbolRecord('ci-2'), referenceRecord('ci-2', { line: 15 })],
    }));
    const rows = db.all(
      `SELECT provenance, extractor FROM edges
        WHERE from_id='ts:caller_fn' AND to_id='ts:callee_fn' AND relation='CALLS'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].provenance).toBe('LSP_VERIFIED');
    // The promoted edge still stashes its heuristic origin (so a later drop can
    // restore it) — and the stash carries the ORIGINAL tree-sitter origin, not
    // an intermediate LSP layer.
    expect(rows[0].extractor).toContain('cpp-clangd#hashBBBB');
    expect(rows[0].extractor).toContain('|was:EXTRACTED::tree-sitter::0.5');
  });

  it('I2: a partial collection does NOT wipe the prior complete verified set', () => {
    // collect-1: complete collection creates an LSP edge from scratch.
    importEnvelope(envelope({
      collectionId: 'ci-1', compileDbHash: 'hashAAAA1111',
      records: [calleeSymbolRecord('ci-1'), referenceRecord('ci-1', { line: 15 })],
    }));
    expect(db.all(`SELECT * FROM edges WHERE provenance='LSP_VERIFIED'`)).toHaveLength(1);

    // collect-2: PARTIAL (budget-exhausted) collection that re-collected a
    // different slice and did not re-report caller_fn→callee_fn. It must NOT
    // run the blanket invalidation, so the prior complete verified edge stays.
    const partialEnv = envelope({
      collectionId: 'ci-2', compileDbHash: 'hashBBBB2222',
      records: [calleeSymbolRecord('ci-2')],
    });
    partialEnv.status = 'partial';
    const stats = importEnvelope(partialEnv);
    expect(stats.edgesInvalidated).toBe(0); // partial never invalidates

    const surviving = db.all(`SELECT extractor FROM edges WHERE provenance='LSP_VERIFIED'`);
    expect(surviving).toHaveLength(1);
    expect(surviving[0].extractor).toBe('cpp-clangd#hashAAAA'); // prior set intact
  });

  it('FIX C: a callee definition enclosed by BOTH a class and a method resolves to the method', () => {
    // A constructor / member body sits at line 52 inside a Class (50-80) AND
    // an inner Method (51-60). Pre-fix the resolver could land the CALLS edge
    // on the enclosing Class; FIX C prefers the innermost callable so the edge
    // targets the Method node.
    const CLASS_FILE = 'src/engine.cpp';
    upsertNode(db, {
      id: 'ts:EngineClass', type: 'Class', label: 'Engine',
      file_path: CLASS_FILE, start_line: 50, end_line: 80, language: 'cpp',
    });
    upsertNode(db, {
      id: 'ts:Engine_ctor', type: 'Method', label: 'Engine',
      file_path: CLASS_FILE, start_line: 51, end_line: 60, language: 'cpp',
    });
    // A caller in another file referencing the method.
    upsertNode(db, {
      id: 'ts:other_caller', type: 'Function', label: 'other_caller',
      file_path: FILE, start_line: 100, end_line: 110, language: 'cpp',
    });

    const calleeId = 'c:cpp:src/engine.cpp:52:3';
    const stats = importEnvelope(envelope({
      records: [
        {
          schema_version: '0.2', collectionId: 'ci-1', kind: 'symbol',
          language: 'cpp', symbolId: calleeId, qname: 'Engine::Engine', name: 'Engine',
          file: CLASS_FILE, range: { start: { line: 52, col: 3 }, end: { line: 60, col: 1 } },
          confidence: 'high', provenance: 'cpp-clangd@0.1.0', result_state: 'found',
        },
        {
          schema_version: '0.2', collectionId: 'ci-1', kind: 'reference',
          language: 'cpp', symbolId: calleeId, qname: 'Engine::Engine',
          file: FILE, range: { start: { line: 105, col: 5 }, end: { line: 105, col: 11 } },
          context: 'call_expr', confidence: 'high', provenance: 'cpp-clangd@0.1.0',
          result_state: 'found',
        },
      ],
    }));

    expect(stats.edgesCreated).toBe(1);
    const edge = db.get(`SELECT from_id, to_id FROM edges WHERE provenance='LSP_VERIFIED'`);
    // Edge lands on the Method node, NOT the enclosing Class.
    expect(edge.to_id).toBe('ts:Engine_ctor');
    expect(edge.to_id).not.toBe('ts:EngineClass');
    expect(edge.from_id).toBe('ts:other_caller');
  });
});
