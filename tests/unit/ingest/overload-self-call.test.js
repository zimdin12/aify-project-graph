// AN INTER-OVERLOAD CALL IS NOT RECURSION.
//
// Node identity is stableId([type, filePath, qname]) and qname carries no
// signature, so `render(int)` and `render(Widget&)` in one file produce the SAME
// id and silently collapse into one node. Nothing recorded that it happened, so a
// call from one overload to the other came back as "this function calls itself"
// (field report 2026-07-27). "Recursive" changes how an agent reasons about a
// function, so a fabricated one is expensive.
//
// Splitting identity by signature is a graph-wide ID migration needing a full
// reindex (tracked separately). What lands here is the DISCLOSURE: the merged node
// records how many declarations it represents, and the resolver refuses to stamp
// EXTRACTED trust on a self-edge it cannot distinguish from an overload call.
// Genuine recursion on a non-merged node keeps full trust.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { resolveRefs, mergesOverloads } from '../../../mcp/stdio/ingest/resolver.js';

function insertFn(db, { id, label, file, extra = {} }) {
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, structural_fp, dependency_fp, extra)
     VALUES ($id,'Function',$label,$file,1,20,'cpp',1,'','',$extra)`,
    { id, label, file, extra: JSON.stringify({ qname: `cpp:${file}:${label}`, ...extra }) },
  );
}

const callRef = (fromId, target, file, line) => ({
  from_id: fromId, relation: 'CALLS', target,
  source_file: file, source_line: line, confidence: 1, extractor: 'cpp',
});

const callsEdge = (result, fromId, toId) =>
  result.edges.find((e) => e.from_id === fromId && e.to_id === toId && e.relation === 'CALLS');

const OVERLOADED = { overloads: 2, overload_signatures: ['render(int)', 'render(Widget&)'] };

describe('self-edges on overload-merged nodes', () => {
  let dir; let db;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'apg-overload-'));
    db = openDb(join(dir, 'graph.sqlite'));
  });
  afterEach(() => { try { db.close(); } catch {} try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('downgrades a self-CALLS edge when the node merges overloads', () => {
    insertFn(db, { id: 'n1', label: 'render', file: 'src/View.cpp', extra: OVERLOADED });

    const result = resolveRefs({ db, refs: [callRef('n1', 'render', 'src/View.cpp', 12)] });

    const edge = callsEdge(result, 'n1', 'n1');
    expect(edge).toBeTruthy();
    // Kept — we cannot prove it is NOT recursion either — but not asserted.
    expect(edge.provenance).toBe('AMBIGUOUS');
  });

  it('leaves genuine recursion on a single-declaration node at full trust', () => {
    // The guard must not over-correct into distrusting every self-call.
    insertFn(db, { id: 'n2', label: 'factorial', file: 'src/Math.cpp' });

    const result = resolveRefs({ db, refs: [callRef('n2', 'factorial', 'src/Math.cpp', 5)] });

    const edge = callsEdge(result, 'n2', 'n2');
    expect(edge).toBeTruthy();
    expect(edge.provenance).not.toBe('AMBIGUOUS');
  });

  it('does not downgrade a NON-self edge into an overload-merged node', () => {
    insertFn(db, { id: 'n3', label: 'render', file: 'src/View.cpp', extra: OVERLOADED });
    insertFn(db, { id: 'n4', label: 'paint', file: 'src/View.cpp' });

    const result = resolveRefs({ db, refs: [callRef('n4', 'render', 'src/View.cpp', 30)] });

    const edge = callsEdge(result, 'n4', 'n3');
    expect(edge).toBeTruthy();
    expect(edge.provenance).not.toBe('AMBIGUOUS');
  });
});

describe('mergesOverloads', () => {
  it('reads the JSON-string extra that SQLite rows carry', () => {
    // The row shape the resolver actually sees. Reading `.extra.overloads` on a
    // string silently yields undefined, which would have made the guard dead code.
    expect(mergesOverloads({ extra: JSON.stringify(OVERLOADED) })).toBe(true);
    expect(mergesOverloads({ extra: '{"overloads":1}' })).toBe(false);
  });

  it('also reads the object extra that in-memory extractor nodes carry', () => {
    expect(mergesOverloads({ extra: OVERLOADED })).toBe(true);
  });

  it('claims nothing on missing or malformed extra', () => {
    expect(mergesOverloads({})).toBe(false);
    expect(mergesOverloads({ extra: 'not json' })).toBe(false);
    expect(mergesOverloads(null)).toBe(false);
  });
});
