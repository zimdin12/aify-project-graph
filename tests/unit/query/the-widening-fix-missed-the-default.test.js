// ⛔ THE FIX FOR THE UNREACHABLE DOC LAYER NAMED "WHEN THE CALLER WIDENED" AND COVERED ONE OF THE
// TWO WIDENED KINDS — THE ONE ALMOST NOBODY PASSES.
//
// search.js already documents this defect, with measurements, above the branch that causes it:
//
//     query        exact-label nodes   fast path   documents matching by heading
//     overlay              4            FIRES                24   ← all unreachable
//     clangd               1            FIRES                13   ← all unreachable
//     sqlite               0            skipped               2   ← returned fine
//
// "A document is reached by its TITLE or its HEADINGS, never by an exact `label` match — a label is
// a filename. So whenever the query happened to be a valid symbol name AND some node carried it
// exactly, this returned early and no document could be returned at all."
//
// The guard written for that was `kind !== 'all'`. But `all` is the EXPLICIT widening, and the
// module sets the default to `auto` at :152 precisely so that OMISSION means discovery — with its
// own comment saying "The public default is now `auto`, and it is what omission does." So `auto` is
// also a widening, it is the one every caller who omits `kind` receives, and the guard skipped it.
//
// ⭐ IS THE POPULATION YOU CHANGED THE POPULATION YOU NAMED. The fix named "the caller widened" and
// implemented "the caller typed all". The justification comment still reads "The default
// `kind:'code'` keeps the fast path: documents are excluded by the filter there anyway" — true when
// it was written, false from the moment the default moved, and nothing checks a comment.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { graphSearch } from '../../../mcp/stdio/query/verbs/search.js';
import { SCHEMA_VERSION } from '../../../mcp/stdio/storage/schema.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

let repo; let graphDir;

/**
 * The shape the defect needs, and it needs BOTH halves:
 *   - a document reachable only by a HEADING, never by its label, and
 *   - a code node whose label EXACTLY equals the query, which is what makes the fast path fire.
 * A fixture with only the document would pass before and after the repair.
 */
const seed = () => {
  const db = openDb(join(graphDir, 'graph.sqlite'));
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, extra)
     VALUES ('d1', 'Document', 'rebuild-notes.md', 'docs/rebuild-notes.md', $e)`,
    { e: JSON.stringify({ title: 'Rebuild notes', headings: ['Overlay', 'Transactions'] }) },
  );
  // Reachable by heading, and its query has NO exact-label twin — the liveness control.
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, extra)
     VALUES ('d2', 'Document', 'storage-notes.md', 'docs/storage-notes.md', $e)`,
    { e: JSON.stringify({ title: 'Storage notes', headings: ['Sqlite', 'Pragmas'] }) },
  );
  // The exact-label twin. Its presence is the whole trigger.
  db.run(
    `INSERT INTO nodes (id, type, label, file_path)
     VALUES ('f1', 'Function', 'overlay', 'mcp/overlay.js')`,
  );
  // ⛔ THE SUBSTRING SIBLING. The exact branch exists to stop an exact query being diluted by
  // broader matches, and the first attempt at this repair deleted that property along with the
  // defect — `get_user` started returning `get_user_profile` and the integration suite caught it.
  db.run(
    `INSERT INTO nodes (id, type, label, file_path)
     VALUES ('f2', 'Function', 'overlayBuilder', 'mcp/overlay-builder.js')`,
  );
  db.close();
};

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'apg-widen-default-'));
  graphDir = join(repo, '.aify-graph');
  mkdirSync(graphDir, { recursive: true });
  writeFileSync(join(graphDir, 'manifest.json'),
    JSON.stringify({ status: 'ok', schemaVersion: SCHEMA_VERSION, commit: 'a'.repeat(40) }));
  seed();
});
afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

const search = (args) => graphSearch({ repoRoot: repo, ...args }).then(String);

describe('the exact fast path must not delete the DEFAULT widening', () => {
  it('★★★ THE REAL CASE: omitting `kind` still reaches a document matched by heading', async () => {
    // `overlay` is both a heading on d1 and the exact label of f1. Before the repair the exact-label
    // branch returned f1 and the widened query was never executed.
    const out = await search({ query: 'overlay' });

    expect(out, 'the code node must still be found — this is not a trade').toMatch(/mcp\/overlay\.js/);
    expect(out, 'the document reachable only by heading must survive the fast path')
      .toMatch(/rebuild-notes\.md/);
    // ⛔ AND EXACT-MATCH PRECISION SURVIVES TOO. Reaching the document must not be bought by
    // letting every substring sibling back in; that trade was made once and the integration
    // suite refused it.
    expectAbsentWithLiveMatcher(
      /overlayBuilder/,
      { forbidden: 'NODE mcp/overlay-builder.js overlayBuilder', allowed: 'NODE mcp/overlay.js overlay' },
      out,
      'an exact symbol query must not be diluted by broader substring matches',
    );
  });

  it('★★★ THE SAME QUERY WITH AN EXPLICIT `all` ALREADY WORKED — so the default was the whole gap', async () => {
    // This is the case the original fix covered. It passing before AND after is the point: it shows
    // the repair did not change the explicit path, and that the defect was exactly the default.
    const out = await search({ query: 'overlay', kind: 'all' });

    expect(out).toMatch(/rebuild-notes\.md/);
  });

  it('★★★ THE DISCRIMINATING CONTROL: an explicit `code` search must NOT gain documents', async () => {
    // Without this, "delete the guard entirely" would pass every other assertion here. A caller who
    // asked for code has not asked for the doc layer, and widening their result is its own defect.
    const out = await search({ query: 'overlay', kind: 'code' });

    expect(out, 'the code node is what this caller asked for').toMatch(/mcp\/overlay\.js/);
    expectAbsentWithLiveMatcher(
      /rebuild-notes\.md/,
      { forbidden: 'NODE docs/rebuild-notes.md Document', allowed: 'NODE docs/storage-notes.md Document' },
      out,
      'kind:"code" must not be widened into the document layer',
    );
  });

  it('★★ THE INSTRUMENT CONTROL: a heading query with no exact-label twin was ALWAYS reachable', async () => {
    // `sqlite` matches d2 by heading and nothing carries it as a label, so the fast path never fired
    // for it — this is the "returned fine" row of the measured table. If this ever fails, the doc
    // matching machinery itself is broken and the assertions above would be reporting the wrong
    // cause entirely.
    const out = await search({ query: 'sqlite' });

    expect(out).toMatch(/storage-notes\.md/);
  });
});
