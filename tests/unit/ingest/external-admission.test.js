import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { upsertNode } from '../../../mcp/stdio/storage/nodes.js';
import { resolveRefs } from '../../../mcp/stdio/ingest/resolver.js';
import { admitExternalEdge, ADMIT, REFUSE } from '../../../mcp/stdio/ingest/external-admission.js';

// ⛔ ONE DOOR FOR EVERY EDGE THAT ENDS ON AN External.
//
// The defect: `buildResolvers` queried `nodes` with no type restriction, so an External that already
// existed came back from ordinary lookup and was bound with no policy consulted. Pre-existence
// ELEVATED a ref that policy refuses — the stub's existence became its own justification.
//
//     REFERENCES to a bare lowercase name, no stub present -> 0 edges
//     the same ref with the stub already there             -> 1 edge
//
// Closed structurally rather than with a bind-site check: External is filtered out of ordinary
// resolution (mergeRows), and a dedicated lookup feeds one admission function. A bind-site `if`
// would leave every future lookup branch able to hand back a stub before policy runs.
//
// ⛔⛔ AND THE HALF THAT MUST NOT REGRESS. An earlier attempt at this refused edges using a label
// pattern presented as a universal truth, and it deleted real `promise.catch()`, `operator()` and
// `save!` edges. Those are ANTI-TARGETS here. A test that only proves the gate fires cannot notice
// that it fires on something real.

describe('external admission — one owner for every External-bound edge', () => {
  let dir;
  let db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'apg-admission-'));
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

  const seedExternal = (label, language = 'js_ts') => upsertNode(db, {
    id: 'external:seed', type: 'External', label, file_path: '', start_line: 0, end_line: 0,
    language, confidence: 0.5, structural_fp: '', dependency_fp: '', extra: { external: true },
  });

  const run = (relation, target, language = 'javascript') => resolveRefs({
    db,
    refs: [{
      from_id: 'fn:caller', relation, target,
      source_file: 'src/a.js', source_line: 3, confidence: 0.7,
      provenance: 'EXTRACTED', extractor: language, language,
    }],
  });

  describe('the defect: pre-existence must not elevate a refused ref', () => {
    it('⛔ a bare lowercase REFERENCES gets no edge WITHOUT a stub', () => {
      expect(run('REFERENCES', 'lowercaseExternal').edges).toHaveLength(0);
    });

    it('⛔⛔ and none WITH one — this returned 1 before the change', () => {
      seedExternal('lowercaseExternal');
      expect(run('REFERENCES', 'lowercaseExternal').edges).toHaveLength(0);
    });

    it('⭐ CONTROL: a type-like REFERENCES still binds to its stub', () => {
      // Without this, "0 edges" above would also be satisfied by refusing every REFERENCES.
      seedExternal('SomeType');
      const { edges } = run('REFERENCES', 'SomeType');
      expect(edges).toHaveLength(1);
      expect(edges[0].to_id).toBe('external:seed');
    });
  });

  describe('anti-targets — names an earlier attempt destroyed', () => {
    it.each([
      ['catch', 'javascript', 'js_ts'],
      ['operator()', 'cpp', 'c_cpp'],
      ['save!', 'ruby', 'ruby'],
      ['#private', 'javascript', 'js_ts'],
      ['@scope/pkg', 'javascript', 'js_ts'],
    ])('⛔ a pre-existing External named %s (%s) still collects its edge', (label, lang, family) => {
      seedExternal(label, family);
      const { edges } = run('CALLS', label, lang);
      expect(edges, `${label} is legal in ${lang} and must keep its edge`).toHaveLength(1);
      expect(edges[0].to_id).toBe('external:seed');
    });
  });

  describe('minting, where refusing is recoverable', () => {
    it('⭐ a real external name is minted and bound', () => {
      const { nodes, edges } = run('CALLS', 'lodashMerge');
      expect(nodes.filter((n) => n.type === 'External')).toHaveLength(1);
      expect(edges).toHaveLength(1);
    });

    it('⛔ a parse fragment is NOT minted', () => {
      const { nodes, edges } = run('CALLS', "execFileSync('git',");
      expect(nodes.filter((n) => n.type === 'External')).toHaveLength(0);
      expect(edges).toHaveLength(0);
    });

    it('⚠ but a fragment that ALREADY EXISTS still binds — the known remaining gap, pinned as open', () => {
      // ⛔ DELIBERATELY ASSERTS A GAP. Separating `execFileSync('git',` from `operator()` cannot be
      // done from a stripped label — proven, at the cost of a revert. It needs the producer's typed
      // form. When that lands, this expectation flips to 0 and the comment goes with it.
      seedExternal("execFileSync('git',");
      expect(run('CALLS', "execFileSync('git',").edges).toHaveLength(1);
    });
  });

  describe('the doors an outside review found still open', () => {
    it('⛔ B2: a JavaScript ref does NOT reuse a PHP terminal of the same name', () => {
      // The old lookup preferred same-family and then fell back to `all[0]`, which I had rationalised
      // as "a wrong reuse is a shared stub, a wrong mint is a duplicate identity — the former is
      // recoverable". That was backwards. A wrong REUSE asserts that two languages' APIs are one
      // symbol; a duplicate never claims anything false.
      upsertNode(db, {
        id: 'external:php-shared', type: 'External', label: 'Shared', file_path: '',
        start_line: 0, end_line: 0, language: 'php', confidence: 0.5,
        structural_fp: '', dependency_fp: '', extra: { external: true },
      });
      const { nodes, edges } = run('CALLS', 'Shared');
      expect(edges).toHaveLength(1);
      expect(edges[0].to_id, 'must not borrow the PHP terminal').not.toBe('external:php-shared');
      expect(nodes.filter((n) => n.type === 'External'), 'it mints its own family-canonical one')
        .toHaveLength(1);
    });

    it('⛔ B4a: a symbolic chain no longer mints a NEW fragment', () => {
      // symbolicChain used to skip admission entirely — unconditional ADMIT, and the missing source
      // owner minted before any policy ran. So "one door for every External-bound edge" was false,
      // and this was not the disclosed pre-existing-fragment gap but a brand new fragment entering
      // the graph.
      const { nodes, edges } = resolveRefs({
        db,
        refs: [{
          from_target: 'MissingOwner', relation: 'CALLS', target: "execFileSync('git',",
          source_file: 'src/a.js', source_line: 4, confidence: 0.7,
          provenance: 'EXTRACTED', extractor: 'javascript', language: 'javascript',
        }],
      });
      expect(edges, 'a fragment target is refused on the symbolic path too').toHaveLength(0);
      expect(nodes.map((n) => n.label), 'and no fragment node is created')
        .not.toContain("execFileSync('git',");
    });

    it('⭐ CONTROL: a symbolic chain with a REAL target still works', () => {
      // Qt `emit signal()` and framework route hops depend on this path. Without this control the
      // test above is satisfied by breaking symbolic chains altogether.
      const { edges } = resolveRefs({
        db,
        refs: [{
          from_target: 'MissingOwner', relation: 'CALLS', target: 'progressChanged',
          source_file: 'src/a.js', source_line: 5, confidence: 0.7,
          provenance: 'EXTRACTED', extractor: 'javascript', language: 'javascript',
        }],
      });
      expect(edges, 'a legitimate symbolic chain must still produce its edge').toHaveLength(1);
    });

    it('⛔ B4b: a pre-resolved to_id naming an External is not a way round admission', () => {
      // The early `ref.to_id` branch emitted without asking what kind of node it pointed at.
      upsertNode(db, {
        id: 'external:seedlower', type: 'External', label: 'lowerlocal', file_path: '',
        start_line: 0, end_line: 0, language: 'js_ts', confidence: 0.5,
        structural_fp: '', dependency_fp: '', extra: { external: true },
      });
      const { edges, unresolved } = resolveRefs({
        db,
        refs: [{
          from_id: 'fn:caller', relation: 'REFERENCES', target: 'lowerlocal',
          to_id: 'external:seedlower',
          source_file: 'src/a.js', source_line: 6, confidence: 0.7,
          provenance: 'EXTRACTED', extractor: 'javascript', language: 'javascript',
        }],
      });
      expect(edges).toHaveLength(0);
      expect(unresolved[0]?.refusedReason).toBe('references-bare-local-name');
    });

    it('⭐ CONTROL: a pre-resolved to_id naming a REAL node still binds untouched', () => {
      // Admission must only intercept ids that name an External. If this failed, every
      // already-resolved edge in the pipeline would be re-adjudicated.
      upsertNode(db, {
        id: 'fn:real', type: 'Function', label: 'realThing', file_path: 'src/b.js',
        start_line: 1, end_line: 3, language: 'javascript', confidence: 1,
        structural_fp: '', dependency_fp: '', extra: {},
      });
      const { edges } = resolveRefs({
        db,
        refs: [{
          from_id: 'fn:caller', relation: 'REFERENCES', target: 'realThing', to_id: 'fn:real',
          source_file: 'src/a.js', source_line: 7, confidence: 0.7,
          provenance: 'EXTRACTED', extractor: 'javascript', language: 'javascript',
        }],
      });
      expect(edges).toHaveLength(1);
      expect(edges[0].to_id).toBe('fn:real');
    });

    it('⛔ the `external:` id convention this check relies on is pinned', () => {
      // The to_id check is a string-prefix test rather than a lookup, for cost. That is only sound
      // while both producers mint ids with this prefix, so the convention is asserted rather than
      // assumed — if a producer changes it, this fails instead of the door quietly reopening.
      const { nodes } = run('CALLS', 'someBrandNewExternalName');
      const minted = nodes.filter((n) => n.type === 'External');
      expect(minted).toHaveLength(1);
      expect(minted[0].id.startsWith('external:')).toBe(true);
    });
  });

  describe('a real declaration always beats a same-leaf terminal', () => {
    it('⭐ the concrete node wins even when a stub of the same name exists', () => {
      // This is what excluding External from ordinary resolution buys, and it is the reason the fix
      // is structural rather than a check at the bind site.
      seedExternal('doThing');
      upsertNode(db, {
        id: 'fn:real', type: 'Function', label: 'doThing', file_path: 'src/b.js',
        start_line: 1, end_line: 3, language: 'javascript', confidence: 1,
        structural_fp: '', dependency_fp: '', extra: {},
      });
      const { edges } = run('CALLS', 'doThing');
      expect(edges).toHaveLength(1);
      expect(edges[0].to_id, 'the first-party declaration must win').toBe('fn:real');
    });
  });

  describe('the decision is typed, and EXTENDS was decided on purpose', () => {
    it('⛔ EXTENDS to an external base class is ADMITTED', () => {
      // Inspected population: 3 of 3 in a fresh index, all `class X extends Error`. The old policy
      // fell through to false for EXTENDS, so these existed only via the bypass; closing it without
      // deciding would have deleted them silently.
      expect(admitExternalEdge({ ref: { from_id: 'x', target: 'Error', relation: 'EXTENDS' } }).decision)
        .toBe(ADMIT);
      expect(run('EXTENDS', 'Error').edges).toHaveLength(1);
    });

    it('⛔ a refusal carries a reason, not a bare false', () => {
      const verdict = admitExternalEdge({ ref: { from_id: 'x', target: 'lower', relation: 'REFERENCES' } });
      expect(verdict.decision).toBe(REFUSE);
      expect(verdict.reason).toBe('references-bare-local-name');
    });

    it('⛔ and the refusal survives into the unresolved record, carrying its reason', () => {
      // A REFUSE that becomes a silent absence is indistinguishable from a ref nobody considered.
      //
      // ⛔ MY FIRST VERSION OF THIS TEST WAS BOTH WRONG AND VACUOUS. It used the target
      // `Lowercase.Thing.notType`, which contains dots and is therefore type-like and ADMITTED — so
      // it exercised no refusal at all — and it asserted `refused.length + unresolved.length > 0`,
      // which is satisfied by either term and pins nothing. TESTS is genuinely unlisted, and the
      // assertion now names the exact reason.
      const { edges, unresolved } = run('TESTS', 'SomeHelper');
      expect(edges).toHaveLength(0);
      expect(unresolved).toHaveLength(1);
      expect(unresolved[0].refusedReason).toBe('relation-not-admitted:TESTS');
    });

    it('⛔ an unlisted relation is refused with its name in the reason', () => {
      const verdict = admitExternalEdge({ ref: { from_id: 'x', target: 'Thing', relation: 'TESTS' } });
      expect(verdict.decision).toBe(REFUSE);
      expect(verdict.reason).toContain('TESTS');
    });
  });
});
