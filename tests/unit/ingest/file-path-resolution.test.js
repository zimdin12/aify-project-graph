// Regression test for Fix B: IMPORTS refs with path-fragment targets
// (`core/Engine.h` style) should resolve to File nodes whose file_path
// ends with the target. Biggest lever for C++ repos — 63% of unresolved
// refs on echoes were this shape.

import { describe, expect, it } from 'vitest';
import { resolveRefs } from '../../../mcp/stdio/ingest/resolver.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withTempDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'apg-resolver-'));
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
    { start_line: 1, end_line: 1, language: 'cpp', confidence: 1, extra: '{}', ...node }
  );
}

describe('resolver — file-path suffix matching for IMPORTS', () => {
  it('resolves C++ #include "core/Engine.h" to the File node at any depth', () => {
    withTempDb((db) => {
      insertNode(db, { id: 'f-engine', type: 'File', label: 'Engine.h', file_path: 'engine/core/Engine.h' });
      insertNode(db, { id: 'f-caller', type: 'File', label: 'Game.cpp', file_path: 'engine/game/Game.cpp' });

      const { edges, unresolved } = resolveRefs({
        db,
        refs: [{
          from_id: 'f-caller',
          relation: 'IMPORTS',
          target: 'core/Engine.h',
          source_file: 'engine/game/Game.cpp',
          source_line: 3,
          confidence: 0.9,
          extractor: 'cpp',
        }],
      });

      expect(unresolved).toHaveLength(0);
      expect(edges).toHaveLength(1);
      expect(edges[0].to_id).toBe('f-engine');
    });
  });

  it('matches path fragments at the suffix boundary, not anywhere in path', () => {
    withTempDb((db) => {
      // Both files end in Engine.h but only one at the correct suffix.
      insertNode(db, { id: 'f1', type: 'File', label: 'Engine.h', file_path: 'engine/core/Engine.h' });
      insertNode(db, { id: 'f2', type: 'File', label: 'Engine.h', file_path: 'engine/notcore/Engine.h' });
      insertNode(db, { id: 'caller', type: 'File', label: 'x.cpp', file_path: 'engine/x.cpp' });

      const { edges } = resolveRefs({
        db,
        refs: [{
          from_id: 'caller',
          relation: 'IMPORTS',
          target: 'core/Engine.h',
          source_file: 'engine/x.cpp',
          source_line: 1,
          confidence: 0.9,
          extractor: 'cpp',
        }],
      });

      // Both file_paths end with `core/Engine.h` technically — first one
      // ends with `/core/Engine.h`, second ends with `notcore/Engine.h`
      // which does NOT match the `%/core/Engine.h` pattern. We should get
      // only the first.
      expect(edges).toHaveLength(1);
      expect(edges[0].to_id).toBe('f1');
    });
  });

  it('does not apply file-path suffix matching to non-IMPORTS relations', () => {
    withTempDb((db) => {
      // A REFERENCES ref with a slashed target should NOT match a file.
      insertNode(db, { id: 'f1', type: 'File', label: 'Engine.h', file_path: 'engine/core/Engine.h' });
      insertNode(db, { id: 'caller', type: 'File', label: 'x.cpp', file_path: 'engine/x.cpp' });

      const { unresolved, edges } = resolveRefs({
        db,
        refs: [{
          from_id: 'caller',
          relation: 'REFERENCES',
          target: 'core/Engine.h',
          source_file: 'engine/x.cpp',
          source_line: 10,
          confidence: 0.9,
          extractor: 'cpp',
        }],
      });

      // With REFERENCES the file-path suffix path is not taken. The
      // existing resolver may materialize an External or leave unresolved;
      // either way, it must NOT edge to f1.
      for (const e of edges) expect(e.to_id).not.toBe('f1');
    });
  });

  it('resolves deep relative JS import paths after extractor normalization', () => {
    withTempDb((db) => {
      insertNode(db, { id: 'target-file', type: 'File', label: 'target_rollup.js', file_path: 'mcp/stdio/query/verbs/target_rollup.js', language: 'javascript' });
      insertNode(db, { id: 'test-file', type: 'File', label: 'query.test.js', file_path: 'tests/unit/query/query.test.js', language: 'javascript' });

      const { edges, unresolved } = resolveRefs({
        db,
        refs: [{
          from_id: 'test-file',
          relation: 'IMPORTS',
          target: 'mcp/stdio/query/verbs/target_rollup.js',
          source_file: 'tests/unit/query/query.test.js',
          source_line: 16,
          confidence: 0.9,
          extractor: 'javascript',
        }],
      });

      expect(unresolved).toHaveLength(0);
      expect(edges).toHaveLength(1);
      expect(edges[0].to_id).toBe('target-file');
    });
  });
});
