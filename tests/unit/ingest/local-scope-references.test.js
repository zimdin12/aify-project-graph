// Regression test for Fix A: REFERENCES refs with bare-lowercase targets
// that don't resolve to any graph node are local-scope false-positives
// (loop vars, local params, etc.). They inflate the unresolved-edges count
// and corrupt TRUST without being fixable. Skipped silently when they
// can't resolve AND don't match any label.
//
// Measured impact: 425/500 unresolved refs on lc-api and 60/500 on apg
// were this shape. Dropping them makes unresolvedEdges honest.

import { describe, expect, it } from 'vitest';
import { resolveRefs } from '../../../mcp/stdio/ingest/resolver.js';
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
  it('silently drops bare-lowercase REFERENCE to unknown label (local var)', () => {
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
      expect(unresolved).toHaveLength(0); // silently dropped, not inflating counts
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
