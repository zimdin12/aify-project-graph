import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { upsertNode } from '../../../mcp/stdio/storage/nodes.js';
import { resolveRefs, isPlausibleExternalName } from '../../../mcp/stdio/ingest/resolver.js';

// ⛔ A NAME, OR NOTHING.
//
// Nothing checked that a materialised External node LOOKED like a symbol, so whenever a parser
// handed back a fragment the graph grew a node labelled `entries()]`, `replace(/\\/g,` or
// `join(dirOf(docPath),`.
//
// ⭐ MEASURED ON THIS REPOSITORY BEFORE THE FIX: 329 of 1,104 External nodes — 29.8% — were
// fragments of that shape, roughly 5% of every labelled node in the graph. They were also the bulk
// of the AMBIGUOUS tier's damage: in a 400-edge sample, 23.3% of AMBIGUOUS CALLS edges pointed at
// one, against 0.8% for EXTRACTED and 0.0% for LSP_VERIFIED.
//
// ⚠ THE RULE WAS DERIVED FROM THAT POPULATION, NOT INVENTED. Applied to the 1,104 existing labels it
// accepted 775 — `slice`, `readFileSync`, `Map`, `createGraph` — and rejected 329, every one a
// fragment. Both samples were inspected before the rule was written.
//
// ⚠ REFUSING IS NOT LOSING. The ref stays in the unresolved list, which is the honest record. A node
// labelled `entries()]` is not more information than an unresolved ref — it is less, because it
// looks like a finding.

describe('an External node must be a plausible symbol name', () => {
  describe('the rule itself, in both directions', () => {
    it('⭐ ACCEPTS every shape a real external symbol takes', () => {
      // Drawn from the accepted half of the real population, plus the separators that appear in
      // qualified names across the languages this repo extracts.
      for (const name of [
        'slice', 'readFileSync', 'Map', 'createGraph', '_private', '$dollar',
        'Foo.bar', 'Foo::bar', 'App\\Http\\Controllers\\Foo', 'some-name', '@scoped',
      ]) {
        expect(isPlausibleExternalName(name), `should accept ${JSON.stringify(name)}`).toBe(true);
      }
    });

    it('⛔ REJECTS every fragment shape actually observed in the graph', () => {
      // These are verbatim labels that were in the graph before the fix.
      for (const frag of [
        'entries()]', 'replace(/\\\\/g,', 'join(dirOf(docPath),', 'map((t)', 'readFileSync(reqPath,',
        'matchAll(', "['node_modules',", 'slice(0,', 'q(db,', '(async', '[', 'String(qname', '',
      ]) {
        expect(isPlausibleExternalName(frag), `should reject ${JSON.stringify(frag)}`).toBe(false);
      }
    });
  });

  describe('driven through resolveRefs', () => {
    let dir;
    let db;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'apg-extname-'));
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

    const ref = (target) => ({
      from_id: 'fn:caller', relation: 'CALLS', target,
      source_file: 'src/a.js', source_line: 3, confidence: 0.7,
      provenance: 'AMBIGUOUS', extractor: 'javascript', language: 'javascript',
    });

    it('⭐ POSITIVE CONTROL: a real external name STILL materialises', () => {
      // Without this the fix is indistinguishable from switching External nodes off entirely.
      const { nodes, edges } = resolveRefs({ db, refs: [ref('lodashMerge')] });
      const ext = nodes.filter((n) => n.type === 'External');
      expect(ext).toHaveLength(1);
      expect(ext[0].label).toBe('lodashMerge');
      expect(edges[0].to_id).toBe(ext[0].id);
    });

    it('⛔ a fragment target materialises NOTHING', () => {
      const { nodes, edges } = resolveRefs({ db, refs: [ref('entries()]')] });
      expect(nodes.filter((n) => n.type === 'External'), 'a fragment is not a symbol').toHaveLength(0);
      expect(edges, 'and no edge may point at one').toHaveLength(0);
    });

    it('⭐ IT DISCRIMINATES: of five targets, exactly the two real names survive', () => {
      // Each assertion above passes for a resolver that materialises everything, or nothing.
      const targets = ['readFileSync', 'map((t)', 'createGraph', 'q(db,', '['];
      const { nodes } = resolveRefs({ db, refs: targets.map(ref) });
      const labels = nodes.filter((n) => n.type === 'External').map((n) => n.label).sort();
      expect(labels).toEqual(['createGraph', 'readFileSync']);
    });
  });
});
