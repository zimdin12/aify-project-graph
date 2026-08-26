import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { upsertNode } from '../../../mcp/stdio/storage/nodes.js';
import { resolveRefs, isReservedCallee } from '../../../mcp/stdio/ingest/resolver.js';

// ⛔ NOTHING CALLS `new`, AND 94 EDGES SAID OTHERWISE.
//
// ⭐ MEASURED on this repository, with a control so the zero-risk was excluded (`readFileSync`
// returns 119 CALLS edges, so the query can find real callees): 100 of 11,350 CALLS edges — 0.88% —
// targeted an External node labelled `new` (94) or `catch` (6). Every one came from JavaScript
// source. The extractor read `new Foo()` and `catch (e)` as call sites, and
// `graph_callers("new")` would have confidently returned 94 callers.
//
// They survived the existing shape guard because `new` IS a valid identifier shape, and they are
// absent from COMMON_NAMES (checked: `new`=false, `catch`=false).
//
// ⚠ THE HARD PART IS THAT IT MUST BE PER-LANGUAGE. `Foo.new(...)` is an ordinary method call in
// Ruby and `Foo::new` exists in C++. A flat keyword denylist would DELETE REAL EDGES in both — the
// "same word, two meanings" trap this project has paid for before. Ruby is deliberately absent from
// the table, and the test below pins that.

describe('a reserved word cannot be a callee — in the language that reserves it', () => {
  describe('the predicate, in every direction', () => {
    it('⛔ REJECTS a JavaScript keyword', () => {
      expect(isReservedCallee('new', 'javascript')).toBe(true);
      expect(isReservedCallee('catch', 'javascript')).toBe(true);
      expect(isReservedCallee('typeof', 'typescript')).toBe(true);
    });

    it('⭐ ACCEPTS an ordinary JavaScript name — it is not rejecting everything', () => {
      for (const name of ['join', 'readFileSync', 'createGraph', 'newThing', 'catcher']) {
        expect(isReservedCallee(name, 'javascript'), name).toBe(false);
      }
    });

    it('⛔⛔ RUBY KEEPS `new` — it is a real method call there', () => {
      // The single most important assertion in this file. A flat denylist would delete every
      // `Foo.new(...)` edge in a Ruby codebase, which is most object construction in the language.
      expect(isReservedCallee('new', 'ruby')).toBe(false);
    });

    it('⛔ an UNKNOWN language gates nothing', () => {
      // Fail-open is correct here and the asymmetry is the reason: a wrong REJECTION deletes a real
      // edge, while a wrong acceptance leaves a stub of the kind already tolerated.
      expect(isReservedCallee('new', 'klingon')).toBe(false);
      expect(isReservedCallee('new', '')).toBe(false);
      expect(isReservedCallee('new', undefined)).toBe(false);
    });
  });

  describe('driven through resolveRefs', () => {
    let dir;
    let db;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'apg-reserved-'));
      db = openDb(join(dir, 'graph.sqlite'));
      upsertNode(db, {
        id: 'fn:caller', type: 'Function', label: 'caller', file_path: 'src/a.js',
        start_line: 1, end_line: 2, language: 'javascript', confidence: 1,
        structural_fp: '', dependency_fp: '', extra: {},
      });
    });
    afterEach(() => {
      try { db.close(); } catch { /* already closed */ }
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    const ref = (target, language) => ({
      from_id: 'fn:caller', relation: 'CALLS', target,
      source_file: 'src/a.js', source_line: 3, confidence: 0.7,
      provenance: 'EXTRACTED', extractor: language, language,
    });

    it('⛔ a JavaScript `new` target materialises NOTHING', () => {
      const { nodes, edges } = resolveRefs({ db, refs: [ref('new', 'javascript')] });
      expect(nodes.filter((n) => n.type === 'External')).toHaveLength(0);
      expect(edges).toHaveLength(0);
    });

    it('⭐ POSITIVE CONTROL: a real external name still materialises', () => {
      // Without this the fix is indistinguishable from switching External nodes off.
      const { nodes } = resolveRefs({ db, refs: [ref('lodashMerge', 'javascript')] });
      expect(nodes.filter((n) => n.type === 'External')).toHaveLength(1);
    });

    it('⛔ the SAME word from Ruby source still materialises', () => {
      // Same label, different language, opposite answer — which is the entire point.
      const { nodes } = resolveRefs({ db, refs: [ref('new', 'ruby')] });
      const ext = nodes.filter((n) => n.type === 'External');
      expect(ext, 'Foo.new is a real Ruby call and must survive').toHaveLength(1);
      expect(ext[0].label).toBe('new');
    });

    it('⭐ IT DISCRIMINATES: of four refs, exactly the two legitimate ones survive', () => {
      const { nodes } = resolveRefs({
        db,
        refs: [
          ref('new', 'javascript'),     // reserved -> dropped
          ref('catch', 'javascript'),   // reserved -> dropped
          ref('new', 'ruby'),           // real method -> kept
          ref('readFileSync', 'javascript'), // ordinary name -> kept
        ],
      });
      const labels = nodes.filter((n) => n.type === 'External').map((n) => n.label).sort();
      expect(labels).toEqual(['new', 'readFileSync']);
    });
  });
});
