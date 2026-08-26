import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { upsertNode } from '../../../mcp/stdio/storage/nodes.js';
import { resolveRefs } from '../../../mcp/stdio/ingest/resolver.js';

// ⛔⛔ THIS FILE EXISTS BECAUSE A GUARD I SHIPPED DELETED REAL EDGES.
//
// Two commits added label-level rules presented as truths: a reserved word "cannot" be a callee, and
// an ASCII shape check applied to EDGES as well as to node creation. An outside review falsified
// both, and the counter-evidence is in this repository:
//
//   · `promise.catch(() => null)` is an ordinary member call and the extractor emits target `catch`.
//     Five of the six `catch` CALLS edges were real: lsp-client.js:207, cpp-clangd.js:148,
//     lsp-collect.js:192, lock.js:22, lsp-evidence.js:299.
//   · The shape pattern rejects `operator()`, `operator<<`, `~Widget`, `save!`, `empty?`, `[]`,
//     `café`, `#private` and `@scope/pkg` — all legal names in a language this tool supports.
//
// ⛔ THE ROOT ERROR WAS AN ASSERTED CAUSE. "The extractor read `new Foo()` and `catch (e)` as call
// sites" was true for `new` and false for `catch`, and I built a rule on it without checking the
// second half. The tests that shipped alongside were green because they pinned the false rule.
//
// ⇒ So these are ANTI-TARGETS: names that must keep working. A test that only proves the guard
// fires cannot notice that it fires on something real.

describe('legitimate callees are not refused', () => {
  let dir;
  let db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'apg-legit-'));
    db = openDb(join(dir, 'graph.sqlite'));
    upsertNode(db, {
      id: 'fn:caller', type: 'Function', label: 'caller', file_path: 'src/a.js',
      start_line: 1, end_line: 9, language: 'javascript', confidence: 1,
      structural_fp: '', dependency_fp: '', extra: {},
    });
  });
  afterEach(() => {
    try { db.close(); } catch { /* already closed */ }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  const ref = (target, language = 'javascript', relation = 'CALLS') => ({
    from_id: 'fn:caller', relation, target,
    source_file: 'src/a.js', source_line: 3, confidence: 0.7,
    provenance: 'EXTRACTED', extractor: language, language,
  });

  const seedExternal = (id, label, language) => upsertNode(db, {
    id, type: 'External', label, file_path: '', start_line: 0, end_line: 0,
    language, confidence: 0.5, structural_fp: '', dependency_fp: '', extra: { external: true },
  });

  describe('a member call whose name is also a keyword', () => {
    // `promise.catch(...)` — the case that made the withdrawn rule delete evidence.
    it('⛔ `catch` from JavaScript materialises and gets an edge', () => {
      const { nodes, edges } = resolveRefs({ db, refs: [ref('catch')] });
      expect(nodes.filter((n) => n.type === 'External')).toHaveLength(1);
      expect(edges).toHaveLength(1);
    });

    it('⛔ a PRE-EXISTING `catch` External still collects its edge', () => {
      // The re-binding path, which is where a wrong rejection deletes an edge that already exists.
      seedExternal('external:catch', 'catch', 'js_ts');
      const { edges } = resolveRefs({ db, refs: [ref('catch')] });
      expect(edges).toHaveLength(1);
      expect(edges[0].to_id).toBe('external:catch');
    });

    it('⚠ `new` binds too — a tolerated stub, honestly', () => {
      // Every `new` site in this repo IS `new Date()` / `new RegExp()`, so this target really is
      // noise. It is kept anyway: `o.new()` is legal JavaScript and legal Ruby, and the label alone
      // cannot tell the two apart. Suppressing it belongs in the extractor, where the syntax is.
      const { edges } = resolveRefs({ db, refs: [ref('new')] });
      expect(edges).toHaveLength(1);
    });
  });

  describe('names the withdrawn shape rule rejected', () => {
    // ⛔ On the BINDING path there must be no shape rule at all. Each of these is a legal name in a
    // supported language, and each was measured returning `edges 0, unresolved 1` under the reverted
    // gate.
    const LEGAL = [
      ['operator()', 'cpp'], ['operator<<', 'cpp'], ['~Widget', 'cpp'],
      ['save!', 'ruby'], ['empty?', 'ruby'], ['[]', 'ruby'],
      ['café', 'python'], ['#private', 'javascript'], ['@scope/pkg', 'javascript'],
    ];

    it.each(LEGAL)('⛔ a pre-existing External named %s (%s) still binds', (label, language) => {
      seedExternal('external:legal', label, language === 'cpp' ? 'c_cpp' : language);
      const { edges } = resolveRefs({ db, refs: [ref(label, language)] });
      expect(edges, `${label} is a legal ${language} name and must keep its edge`).toHaveLength(1);
      expect(edges[0].to_id).toBe('external:legal');
    });
  });

  describe('what the surviving creation policy still does', () => {
    it('⭐ CONTROL: a parse fragment is still not MINTED as a new node', () => {
      // Without this the file above would be satisfied by removing every guard, and the fragment
      // defect that started this arc would silently return.
      const { nodes, edges } = resolveRefs({ db, refs: [ref("execFileSync('git',")] });
      expect(nodes.filter((n) => n.type === 'External')).toHaveLength(0);
      expect(edges).toHaveLength(0);
    });

    it('⚠ but a fragment that ALREADY EXISTS still re-binds — the open defect, pinned as open', () => {
      // ⛔ THIS ASSERTS A DEFECT, DELIBERATELY, so the successor has a failing-on-fix marker rather
      // than a silent regression. The re-binding hole is real; the reverted fix was worse than the
      // hole. When one admission policy covers creation AND binding, this expectation flips to 0 and
      // this comment goes with it.
      seedExternal('external:frag', "execFileSync('git',", 'js_ts');
      const { edges } = resolveRefs({ db, refs: [ref("execFileSync('git',")] });
      expect(edges, 'known open: pre-existence bypasses the creation policy').toHaveLength(1);
    });
  });
});
