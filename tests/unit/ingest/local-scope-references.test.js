// REFERENCES refs with bare-lowercase targets that resolve to nothing are local-scope
// false-positives — loop vars, local params. They are not fixable, and counting them as unresolved
// made TRUST read worse than reality. Measured: 425/500 unresolved refs on lc-api, 60/500 on apg.
//
// ⛔ THEY USED TO BE DROPPED SILENTLY, AND THAT WAS A DEFECT AN OUTSIDE REVIEW CAUGHT. Executed, a
// bare lowercase REFERENCES produced edges 0 AND unresolved 0 — the resolver had made a typed
// refusal decision and then erased every trace of it, while the module comment and commit message
// both claimed refusals were never silent.
//
// ⇒ "NOT TRUST-RELEVANT" MUST NOT BE IMPLEMENTED AS "DID NOT HAPPEN". The ref is now RETAINED in
// the unresolved carrier with its `refusedReason`, and the categorizer buckets it as
// `external-by-design:admission-refused` so the trust denominator is unchanged AND the exclusion is
// published by explainTrustExclusions. The honest count and the visible decision are both preserved;
// this test now pins that, where it used to pin the erasure.

import { describe, expect, it } from 'vitest';
import { resolveRefs } from '../../../mcp/stdio/ingest/resolver.js';
import { countTrustRelevantDirtyEdges } from '../../../mcp/stdio/freshness/unresolved-metrics.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withTempDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'apg-local-scope-'));
  const db = openDb(join(dir, 'graph.sqlite'));
  try {
    return fn(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function insertNode(db, node) {
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
     VALUES ($id, $type, $label, $file_path, $start_line, $end_line, $language, $confidence, $extra)`,
    { start_line: 1, end_line: 1, language: 'javascript', confidence: 1, extra: '{}', ...node }
  );
}

describe('resolver — local-scope REFERENCES filter', () => {
  it('⛔ RETAINS a refused bare-lowercase REFERENCE as a typed record, not silence', () => {
    withTempDb((db) => {
      insertNode(db, { id: 'fn1', type: 'Function', label: 'doSomething', file_path: 'src/a.js' });

      const { edges, unresolved } = resolveRefs({
        db,
        refs: [{
          from_id: 'fn1',
          relation: 'REFERENCES',
          target: 'nodeId', // local var — no such label anywhere
          source_file: 'src/a.js',
          source_line: 10,
          confidence: 0.9,
          extractor: 'javascript',
        }],
      });

      expect(edges).toHaveLength(0);
      // Retained, with the reason the admission owner gave — the record is the evidence.
      expect(unresolved).toHaveLength(1);
      expect(unresolved[0].refusedReason).toBe('references-bare-local-name');
      // ⭐ AND THE OTHER HALF, which is the entire justification for retaining it: visible, but not
      // counted against trust. Without this assertion the change would trade a silent drop for an
      // inflated trust denominator — the very thing the original silent drop existed to prevent.
      expect(countTrustRelevantDirtyEdges(unresolved)).toBe(0);
    });
  });

  it('keeps an REFERENCE whose label DOES exist in the graph (real cross-scope ref)', () => {
    withTempDb((db) => {
      insertNode(db, { id: 'fn1', type: 'Function', label: 'authenticate', file_path: 'src/a.js' });
      insertNode(db, { id: 'fn2', type: 'Function', label: 'caller', file_path: 'src/b.js' });

      const { edges, unresolved } = resolveRefs({
        db,
        refs: [{
          from_id: 'fn2',
          relation: 'REFERENCES',
          target: 'authenticate', // lowercase but matches a real function label
          source_file: 'src/b.js',
          source_line: 5,
          confidence: 0.9,
          extractor: 'javascript',
        }],
      });

      // Either resolved into an edge or left in unresolved — both acceptable.
      // What matters: NOT silently dropped.
      const total = edges.length + unresolved.length;
      expect(total).toBeGreaterThanOrEqual(1);
    });
  });

  it('keeps an uppercase REFERENCE target (type-like) even when unresolved', () => {
    withTempDb((db) => {
      insertNode(db, { id: 'fn1', type: 'Function', label: 'caller', file_path: 'src/a.js' });

      const { edges, unresolved } = resolveRefs({
        db,
        refs: [{
          from_id: 'fn1',
          relation: 'REFERENCES',
          target: 'SomeType', // uppercase — looks like a type, not a local var
          source_file: 'src/a.js',
          source_line: 3,
          confidence: 0.9,
          extractor: 'javascript',
        }],
      });

      // Uppercase target shouldn't be filtered. Either materialized External
      // or kept as unresolved — but not silently dropped.
      expect(edges.length + unresolved.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('does NOT affect non-REFERENCES relations (CALLS etc. still go through)', () => {
    withTempDb((db) => {
      insertNode(db, { id: 'fn1', type: 'Function', label: 'caller', file_path: 'src/a.js' });

      const { edges, unresolved } = resolveRefs({
        db,
        refs: [{
          from_id: 'fn1',
          relation: 'CALLS',
          target: 'nodeId', // same bare lowercase, but CALLS not REFERENCES
          source_file: 'src/a.js',
          source_line: 10,
          confidence: 0.9,
          extractor: 'javascript',
        }],
      });

      // CALLS materializes an External node; it's not silently dropped.
      expect(edges.length + unresolved.length).toBeGreaterThanOrEqual(1);
    });
  });
});
