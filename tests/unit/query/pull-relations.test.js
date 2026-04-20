// Regression test for round-4 audit fix (2026-04-20):
// graph_pull previously filtered edges on relation IN ('CALLS', 'REFERENCES',
// 'USES_TYPE') only, silently dropping INVOKES and PASSES_THROUGH — which
// meant Laravel middleware chains and other route-like execution traces
// came back incomplete. Fix: extended all 5 relation-filter clauses.
//
// End-to-end test would need full git + ensureFresh setup; this
// file-inspection test catches the class of regression (someone removes
// INVOKES or PASSES_THROUGH from the SQL strings) without the complexity.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pullJsPath = join(__dirname, '../../..', 'mcp', 'stdio', 'query', 'verbs', 'pull.js');

describe('graph_pull — relation coverage (round-4 regression)', () => {
  it('all edge-relation filter clauses include INVOKES and PASSES_THROUGH', () => {
    const src = readFileSync(pullJsPath, 'utf8');
    // Find every `e.relation IN (...)` clause
    const clauses = [...src.matchAll(/e\.relation\s+IN\s*\(([^)]+)\)/g)];
    expect(clauses.length).toBeGreaterThan(0);
    for (const m of clauses) {
      const rels = m[1];
      expect(rels, `clause at index ${m.index} missing INVOKES`).toContain('INVOKES');
      expect(rels, `clause at index ${m.index} missing PASSES_THROUGH`).toContain('PASSES_THROUGH');
    }
  });

  it('includes base relations (CALLS, REFERENCES, USES_TYPE)', () => {
    const src = readFileSync(pullJsPath, 'utf8');
    const clauses = [...src.matchAll(/e\.relation\s+IN\s*\(([^)]+)\)/g)];
    for (const m of clauses) {
      const rels = m[1];
      expect(rels).toContain('CALLS');
      expect(rels).toContain('REFERENCES');
      expect(rels).toContain('USES_TYPE');
    }
  });
});
