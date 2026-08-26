import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { upsertNode } from '../../../mcp/stdio/storage/nodes.js';
import { resolveRefs, isImpossibleExternalTarget } from '../../../mcp/stdio/ingest/resolver.js';

// ⛔ A GATE ON CREATION IS NOT A GATE ON THE EDGE.
//
// Two earlier guards refuse to CREATE an External node from a parse fragment (`entries()]`) or from
// a word the language reserves (`new`). Both are consulted in exactly one place:
// shouldMaterializeExternal, which resolveRefs reaches only when resolveTarget found nothing.
//
// ⭐ THE DEFECT, PROVEN WITH BOTH ARMS IN ONE PASS BEFORE THE FIX: buildResolvers queries the nodes
// table with NO type restriction, so findByLabel returns External nodes already in the graph. Seed a
// node labelled `execFileSync('git',` and an identical ref BOUND TO IT — edge created, gate never
// consulted. Run the same ref against an empty graph and the gate refused it. So the fragments were
// not historical residue waiting to age out: every re-index of the file that produced one
// re-attached to it, and on this repository 526 CALLS edges pointed at a label containing `(`.
//
// ⚠ WHAT IS DELIBERATELY *NOT* APPLIED ON THE RE-BINDING PATH: COMMON_NAMES and the per-relation
// rules. Those say a node is not WORTH CREATING, which is only a question at creation time. Only the
// label-truths — this cannot be a symbol, this cannot be a callee in this language — hold regardless
// of how the edge arose. The tests below pin both halves of that split.

describe('a fragment already in the graph is not re-bound', () => {
  let dir;
  let db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'apg-residue-'));
    db = openDb(join(dir, 'graph.sqlite'));
    upsertNode(db, {
      id: 'fn:caller', type: 'Function', label: 'caller', file_path: 'scripts/gate-receipt.mjs',
      start_line: 1, end_line: 9, language: 'javascript', confidence: 1,
      structural_fp: '', dependency_fp: '', extra: {},
    });
  });
  afterEach(() => {
    try { db.close(); } catch { /* already closed */ }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  const seedExternal = (id, label, language) => upsertNode(db, {
    id, type: 'External', label, file_path: '', start_line: 0, end_line: 0,
    language, confidence: 0.5, structural_fp: '', dependency_fp: '', extra: { external: true },
  });

  const ref = (target, language = 'javascript') => ({
    from_id: 'fn:caller', relation: 'CALLS', target,
    source_file: 'scripts/gate-receipt.mjs', source_line: 4, confidence: 0.7,
    provenance: 'EXTRACTED', extractor: language, language,
  });

  it('⛔ THE DEFECT: a seeded parse fragment collects no new edge', () => {
    // Before the fix this produced exactly one edge, to external:seeded-fragment.
    seedExternal('external:seeded-fragment', "execFileSync('git',", 'js_ts');
    const { edges, unresolved } = resolveRefs({ db, refs: [ref("execFileSync('git',")] });
    expect(edges).toHaveLength(0);
    // ⚠ And it is REFUSED, not silently dropped — the ref survives as the honest record.
    expect(unresolved).toHaveLength(1);
  });

  it('⛔ a seeded reserved word collects no new edge either', () => {
    seedExternal('external:seeded-new', 'new', 'js_ts');
    const { edges } = resolveRefs({ db, refs: [ref('new')] });
    expect(edges).toHaveLength(0);
  });

  it('⭐ POSITIVE CONTROL: a seeded REAL external still binds', () => {
    // Without this the fix is indistinguishable from breaking External re-binding altogether, and
    // every one of these tests would still be green.
    seedExternal('external:seeded-real', 'lodashMerge', 'js_ts');
    const { edges } = resolveRefs({ db, refs: [ref('lodashMerge')] });
    expect(edges).toHaveLength(1);
    expect(edges[0].to_id).toBe('external:seeded-real');
  });

  it('⚠ a seeded COMMON name binds nothing either — and NOT because of this fix', () => {
    // ⛔ I FIRST WROTE THIS ASSERTING THE OPPOSITE, from the design rationale rather than from a
    // run, and it failed. resolveTarget declines a label match for a COMMON_NAME unless it is
    // uniquely in the ref's own file, and an External node (file_path '') never is. That rule
    // predates this change and is stricter than the gate.
    //
    // ⇒ So this pins EXISTING behaviour, not new behaviour, and it is recorded here only because the
    // comment beside the fix would otherwise imply a distinction that is currently unobservable.
    seedExternal('external:seeded-get', 'get', 'js_ts');
    const { edges } = resolveRefs({ db, refs: [ref('get')] });
    expect(edges).toHaveLength(0);
  });

  it('⛔⛔ RUBY KEEPS `new` ON THE RE-BINDING PATH TOO', () => {
    // The language-specific truth has to travel with the fix, or Ruby object construction loses its
    // edges the moment those nodes already exist — which, in a maintained graph, is always.
    seedExternal('external:seeded-ruby-new', 'new', 'ruby');
    const { edges } = resolveRefs({ db, refs: [ref('new', 'ruby')] });
    expect(edges).toHaveLength(1);
    expect(edges[0].to_id).toBe('external:seeded-ruby-new');
  });

  it('⭐ IT DISCRIMINATES: of three seeded externals, exactly the possible one collects an edge', () => {
    seedExternal('external:d-frag', 'slice(0,', 'js_ts');
    seedExternal('external:d-kw', 'catch', 'js_ts');
    seedExternal('external:d-real', 'readFileSync', 'js_ts');
    const { edges } = resolveRefs({
      db,
      refs: [ref('slice(0,'), ref('catch'), ref('readFileSync')],
    });
    expect(edges.map((e) => e.to_id)).toEqual(['external:d-real']);
  });
});

describe('isImpossibleExternalTarget — the shared predicate', () => {
  it('⛔ rejects a fragment and a reserved word', () => {
    expect(isImpossibleExternalTarget("execFileSync('git',", 'javascript')).toBe(true);
    expect(isImpossibleExternalTarget('entries()]', 'javascript')).toBe(true);
    expect(isImpossibleExternalTarget('new', 'javascript')).toBe(true);
  });

  it('⭐ accepts real names, INCLUDING common ones', () => {
    for (const name of ['readFileSync', 'lodashMerge', 'get', 'open', 'Foo.bar', 'Acme\\Widget']) {
      expect(isImpossibleExternalTarget(name, 'javascript'), name).toBe(false);
    }
  });

  it('⛔ the language argument decides, and is not ignored', () => {
    expect(isImpossibleExternalTarget('new', 'javascript')).toBe(true);
    expect(isImpossibleExternalTarget('new', 'ruby')).toBe(false);
  });
});
