// Regression test for round-4 audit fix (2026-04-20):
// graph_pull previously filtered edges on relation IN ('CALLS', 'REFERENCES',
// 'USES_TYPE') only, silently dropping INVOKES and PASSES_THROUGH — which
// meant Laravel middleware chains and other route-like execution traces
// came back incomplete. Fix: extended all relation-filter clauses.
//
// Cohesion review R2 (2026-05): pull.js no longer inlines the relation list —
// every clause now interpolates a single shared `PULL_TOUCH_SQL_LIST` constant
// composed from the taxonomy registry (CALL_FAMILY + USES_TYPE). This test was
// updated deliberately: instead of grepping each inline SQL literal, it asserts
// (a) the registry-composed touch set still covers all five relations, and
// (b) pull.js routes every relation clause through that single shared constant
// (so a future edit can't silently drop INVOKES/PASSES_THROUGH from just one).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { CALL_FAMILY } from '../../../mcp/stdio/storage/taxonomy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pullJsPath = join(__dirname, '../../..', 'mcp', 'stdio', 'query', 'verbs', 'pull.js');

// The exact set pull.js composes for its relation rollups.
const PULL_TOUCH_RELATIONS = [...CALL_FAMILY, 'USES_TYPE'];

describe('graph_pull — relation coverage (round-4 regression, registry-wired)', () => {
  it('the pull touch set covers CALLS, REFERENCES, USES_TYPE, INVOKES, PASSES_THROUGH', () => {
    for (const rel of ['CALLS', 'REFERENCES', 'USES_TYPE', 'INVOKES', 'PASSES_THROUGH']) {
      expect(PULL_TOUCH_RELATIONS).toContain(rel);
    }
  });

  it('every e.relation IN (...) clause routes through the shared PULL_TOUCH_SQL_LIST constant', () => {
    const src = readFileSync(pullJsPath, 'utf8');
    const clauses = [...src.matchAll(/e\.relation\s+IN\s*\(([^)]+)\)/g)];
    expect(clauses.length).toBeGreaterThan(0);
    for (const m of clauses) {
      const rels = m[1].trim();
      // Either the shared constant interpolation, or (for the single-relation
      // IMPORTS file query) a deliberate literal. No clause may inline the
      // multi-relation touch list — that's what regressed before.
      // ⚠ THE PROPERTY IS "NO CLAUSE INLINES A RELATION LIST", NOT "EVERY CLAUSE USES THIS ONE
      // CONSTANT". This originally required `PULL_TOUCH_SQL_LIST` by name, and adding a SECOND
      // registry-composed family — `PULL_DOC_SQL_LIST`, from taxonomy DOC_FAMILY, after the docs
      // layer was caught answering from a hardcoded 'MENTIONS' — turned it red while satisfying
      // everything the test is for. A guard that names one permitted spelling has to be edited
      // every time the codebase does the right thing in a new place, and an assertion people
      // routinely edit to make green stops being an assertion.
      //
      // ⇒ Accept any `${…SQL_LIST}` interpolation. Those are composed from the taxonomy registry
      // by construction, so the thing being prevented — a hand-typed relation list that can drift
      // from the registry — still cannot pass.
      const usesSharedConst = /^\$\{[A-Z_]*SQL_LIST\}$/.test(rels);
      const isSingleImports = /^'IMPORTS'$/.test(rels);
      expect(
        usesSharedConst || isSingleImports,
        `clause at index ${m.index} inlines relations instead of using the shared constant: ${rels}`,
      ).toBe(true);
    }
  });
});
