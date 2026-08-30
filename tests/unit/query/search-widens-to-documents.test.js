// THE FOUNDING QUESTION FAILED ON THE DEFAULT PATH.
//
// THE-GOAL names documents as the base layer and the product's problem as DISCOVERY — "my agent
// asked me where the game design doc is; he has worked on the project for 2 months". Measured on
// this repository before this change: 230 documents indexed, and "the goal", "why is the rebuild one
// transaction" and "PHP language server decision" ALL returned NO RESULTS, because `kind` defaults
// to "code" and that excludes Document nodes.
//
// The old message named the narrowing and gave the exact remedy, which is honest. But THE-GOAL also
// says "a disclosure nobody acts on is slop", the remedy costs a round trip to an agent whose whole
// problem is having forgotten the document exists, and that message had been delivered ZERO times
// across 1,078 transcripts on this machine.
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
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, extra)
     VALUES ('d1', 'Document', 'THE-GOAL.md', 'docs/THE-GOAL.md', $extra)`,
    { extra: JSON.stringify({ title: 'The goal', headings: ['The end state', 'The bar'] }) },
  );
  db.run(
    `INSERT INTO nodes (id, type, label, file_path)
     VALUES ('f1', 'Function', 'computeTrustLevel', 'mcp/trust.js')`,
  );
  db.close();
};

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'apg-widen-'));
  graphDir = join(repo, '.aify-graph');
  mkdirSync(graphDir, { recursive: true });
  writeFileSync(join(graphDir, 'manifest.json'),
    JSON.stringify({ status: 'ok', schemaVersion: SCHEMA_VERSION, commit: 'a'.repeat(40) }));
  seed();
});
afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

const search = (args) => graphSearch({ repoRoot: repo, ...args }).then(String);

describe('a discovery question reaches the document layer on the DEFAULT path', () => {
  it('finds a document when no code matches', async () => {
    // Catches the founding defect: 230 documents indexed and the default search reporting NO RESULTS.
    const out = await search({ query: 'The goal' });
    expect(out, 'the document must be returned').toMatch(/THE-GOAL\.md/);
  });

  it('reaches a document by a HEADING, not just its title', async () => {
    // Headings are why this is discovery rather than filename lookup — an agent remembers a topic,
    // not a filename.
    const out = await search({ query: 'The end state' });
    expect(out).toMatch(/THE-GOAL\.md/);
  });

  it('POSITIVE CONTROL: a code query still returns code, unwidened', async () => {
    // Without this, every assertion above is satisfied by a verb that widened unconditionally.
    const out = await search({ query: 'computeTrustLevel' });
    expect(out).toMatch(/computeTrustLevel/);
    expectAbsentWithLiveMatcher(
      /WIDENED/,
      { forbidden: 'WIDENED: no code matched, so this searched Document', allowed: 'NODE f1 function computeTrustLevel' },
      out,
      'a search that found code must not report widening',
    );
  });
});

describe('the widening belongs to whoever caused the narrowing', () => {
  it('does NOT widen under a caller who explicitly asked for code', async () => {
    // Catches: answering a question the caller did not ask. kindSupplied exists to tell an explicit
    // 'code' from the default one, and this is the case it was built for.
    const out = await search({ query: 'The goal', kind: 'code' });
    expect(out).toMatch(/NO RESULTS/);
    expectAbsentWithLiveMatcher(
      /WIDENED/,
      { forbidden: 'WIDENED: no code matched, so this searched Document', allowed: 'NO RESULTS for "The goal"' },
      out,
      'an explicit kind=code caller must be answered on their own terms',
    );
    expect(out, 'and THEY should still be told the widening move exists').toMatch(/kind="all"/);
  });

  it('never re-suggests a widening it already performed', async () => {
    // ⛔ A REMEDY ALREADY TRIED IS NOT A REMEDY. When the default narrowing is undone automatically
    // and the widened search also finds nothing, pointing the reader at kind="all" sends them to a
    // call whose answer is already computed — the non-terminating shape this file warns about.
    const out = await search({ query: 'zzzz-no-such-topic-anywhere' });
    expect(out).toMatch(/NO RESULTS/);
    expect(out, 'the zero must name the population actually searched')
      .toMatch(/Document\/Directory\/Config nodes were searched/);
    expectAbsentWithLiveMatcher(
      /kind="all"/,
      { forbidden: 'Next: graph_search(query="x", kind="all") to include docs/configs', allowed: 'Next: graph_pull for cross-layer context on a known node.' },
      out,
      'a widening already performed must not be offered as the next step',
    );
  });
});

// WHERE A TOKEN SITS DECIDES WHAT IT IS WORTH.
// Measured on the pinned corpus: for "parameter types", click's api.md carries both tokens across
// its twelve headings while parameter-types.md carries both in its NAME. The scorer compared only
// against the WHOLE query string, so both scored exactly 100 and the wrong document won on a
// tie-break. A flat token count did not fix it either — both still tied. A name or title is a claim
// about the whole document; a heading is a claim about one section.
describe('a document that is ABOUT the topic outranks one that merely mentions it', () => {
  const seedTwoDocs = () => {
    const db = openDb(join(graphDir, 'graph.sqlite'));
    // ⛔ INSERTED FIRST ON PURPOSE. With equal scores the tie breaks on row order, so if the
    // heading-only document did not come first, a mutant that weights names and headings the same
    // would still pass — measured: it did, until this fixture was corrected.
    db.run(
      `INSERT INTO nodes (id, type, label, file_path, extra)
       VALUES ('n1', 'Document', 'api.md', 'docs/api.md', $e)`,
      { e: JSON.stringify({ title: 'API reference', headings: ['Parameter', 'Types', 'Context', 'Command'] }) },
    );
    // Named for the topic — two query tokens in its own filename.
    db.run(
      `INSERT INTO nodes (id, type, label, file_path, extra)
       VALUES ('n2', 'Document', 'parameter-types.md', 'docs/parameter-types.md', $e)`,
      { e: JSON.stringify({ title: 'Parameter types', headings: ['Choice', 'Path'] }) },
    );
    // ⛔ AND CODE THAT MATCHES THE SAME QUERY. Without it the query finds no code, the
    // widen-on-zero path answers, and a mutant disabling the PROSE path passes untouched —
    // measured: it did. Code matching is the whole condition the prose path exists for.
    db.run(
      `INSERT INTO nodes (id, type, label, file_path)
       VALUES ('c1', 'Function', 'convert_parameter_types', 'click/types.py')`,
    );
    db.close();
  };

  it('ranks the document NAMED for the topic above the one that only has matching headings', async () => {
    // Catches the tie-break that sent "shell completion" to api.md instead of shell-completion.md.
    // ⚠ ASSERTED AS "WHICH ONE IS CHOSEN", NOT "WHICH COMES FIRST". `reserveForWidened` deliberately
    // appends its promoted slot LAST so a reservation never displaces the top results, so ordering
    // within a large page tests that mechanism rather than the ranking. Squeezing the page to one
    // slot asks the question this fix is actually about: of the documents that matched, which is the
    // best answer.
    seedTwoDocs();
    const out = await search({ query: 'parameter types', limit: 1 });
    const docs = out.split('\n').filter((l) => /^NODE .* document /.test(l));
    expect(docs.length, 'one slot, so exactly one document is the answer').toBe(1);
    expect(docs[0], 'the document NAMED for the topic must be the one chosen').toMatch(/parameter-types\.md/);
  });

  it('POSITIVE CONTROL: a heading-only match is still returned, just lower', async () => {
    // The fix must re-rank, not exclude. A document whose headings match is a real answer to a
    // question about one of its sections, and dropping it would trade a ranking bug for a recall one.
    seedTwoDocs();
    const out = await search({ query: 'context command', limit: 5 });
    expect(out, 'api.md matches only via headings and must still be reachable').toMatch(/api\.md/);
  });
});
