// ⛔ THE REPAIR THAT ADDED THE DOCUMENT LAYER BROKE THREE RULES THE BRANCH IT JOINED ALREADY KEPT.
//
// 068b4b79 fixed a real defect — an exact symbol query deleted the document widening — by ADDING a
// document query beside the exact-label one instead of deleting the branch. The added query was
// written from scratch and inherited none of its neighbour's contracts:
//
//   1. NO FILTERS. It carries no `baseClauses`/`baseParams`, so `file:` never reaches documents and
//      a caller who scoped to one directory is handed matches from anywhere in the repository.
//   2. NO DEDUPE. A Document whose label happens to equal the query is returned by BOTH queries, so
//      the same node is rendered twice.
//   3. TWO BUDGETS, NOT ONE. Each query carries its own `LIMIT`, and the results are concatenated —
//      so `limit: 1` can return two rows.
//
// ⛔ AND BOTH QUERIES USE `LIMIT $limit` WITH NO `+ 1` AND NO TRUNCATION FLAG, so each caps in
// silence. That is "a cap is not a count", the defect class this repository spent a night removing
// from five verbs — and I reproduced it in new code written during that same session.
//
// ⭐ THE SHAPE: A BRANCH ADDED BESIDE AN EXISTING ONE INHERITS NONE OF ITS CONTRACTS AUTOMATICALLY.
// Filters, identity, budget and disclosure each had to be carried across by hand, and I carried none.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { graphSearch } from '../../../mcp/stdio/query/verbs/search.js';
import { SCHEMA_VERSION } from '../../../mcp/stdio/storage/schema.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

let repo; let graphDir;

const seed = () => {
  const db = openDb(join(graphDir, 'graph.sqlite'));
  // The exact-label code node: its presence is what makes the exact branch fire at all.
  db.run(`INSERT INTO nodes (id, type, label, file_path) VALUES ('f1','Function','alpha','src/a.js')`);
  // A document OUTSIDE the scope a caller may ask for, reachable by heading.
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, extra) VALUES ('d1','Document','notes.md','docs/notes.md',$e)`,
    { e: JSON.stringify({ title: 'Notes', headings: ['Alpha', 'Beta'] }) },
  );
  // A document whose LABEL is exactly the query — the node both queries can return.
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, extra) VALUES ('d2','Document','alpha','docs/alpha.md',$e)`,
    { e: JSON.stringify({ title: 'Alpha', headings: ['Alpha'] }) },
  );
  db.close();
};

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'apg-added-branch-'));
  graphDir = join(repo, '.aify-graph');
  mkdirSync(graphDir, { recursive: true });
  writeFileSync(join(graphDir, 'manifest.json'),
    JSON.stringify({ status: 'ok', schemaVersion: SCHEMA_VERSION, commit: 'a'.repeat(40) }));
  seed();
});
afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

const search = (args) => graphSearch({ repoRoot: repo, ...args }).then(String);
const lines = (out) => out.split('\n').filter((l) => l.startsWith('NODE '));

describe('the document branch obeys the filters, identity and budget of the one it joined', () => {
  it('★★★ FILE SCOPE REACHES DOCUMENTS: a doc outside the scope is not returned', async () => {
    const out = await search({ query: 'alpha', file: 'src/' });

    expect(out, 'the in-scope code node is what was asked for').toMatch(/src\/a\.js/);
    expectAbsentWithLiveMatcher(
      /docs\/notes\.md/,
      { forbidden: 'NODE docs/notes.md Document', allowed: 'NODE src/a.js Function' },
      out,
      'a scoped search must not be handed documents from outside the scope',
    );
  });

  it('★★★ ONE NODE APPEARS ONCE: a document whose label equals the query is not duplicated', async () => {
    // d2 is returned by the exact-label query AND by the document query. Concatenating without
    // dedupe rendered it twice, which reads as two separate findings.
    const out = await search({ query: 'alpha' });
    const hits = lines(out).filter((l) => l.includes('docs/alpha.md'));

    expect(hits).toHaveLength(1);
  });

  it('★★★ ONE BUDGET: limit is a limit on the ANSWER, not on each query separately', async () => {
    const out = await search({ query: 'alpha', limit: 1 });

    expect(lines(out), 'limit 1 must yield one node line').toHaveLength(1);
  });

  it('★★★ AND A TRUNCATED ANSWER SAYS SO — the exact path capped in silence', async () => {
    // Both queries used `LIMIT $limit` with no `+ 1`, so neither could detect saturation and the
    // renderer was never told. A capped result that does not disclose is the defect this repository
    // removed from five verbs the night before this branch was written.
    const out = await search({ query: 'alpha', limit: 1 });

    expect(out).toMatch(/more|TRUNCATED/);
  });

  it('★★ THE DISCRIMINATING CONTROL: unscoped, the heading-matched document still arrives', async () => {
    // Without this, every assertion above is satisfied by a repair that simply stopped returning
    // documents — which is the defect 068b4b79 existed to fix.
    const out = await search({ query: 'alpha', limit: 20 });

    expect(out).toMatch(/docs\/notes\.md/);
  });

  it('★★ AND kind="code" still excludes documents entirely', async () => {
    const out = await search({ query: 'alpha', kind: 'code', limit: 20 });

    expect(out).toMatch(/src\/a\.js/);
    expectAbsentWithLiveMatcher(
      /docs\//,
      { forbidden: 'NODE docs/notes.md Document', allowed: 'NODE src/a.js Function' },
      out,
      'kind:"code" must not be widened into the document layer',
    );
  });
});
