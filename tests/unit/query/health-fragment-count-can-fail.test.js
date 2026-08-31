// ⛔ A ZERO THAT CANNOT FAIL IS NOT A MEASUREMENT.
//
// countFragmentExternals returned 0 from its catch, and 0 is also the healthy answer. Its only
// consumer is `if (fragmentExternals > 0)`, so three different situations produced byte-identical
// output — silence in the verdict summary a reader consults to decide whether anything is wrong:
//
//   the scan ran and found none          -> silence, correct
//   the graph could not be opened        -> silence, WRONG
//   the `nodes` table could not be read  -> silence, WRONG
//
// The catch also carried `console.error('COUNT THREW:', ...)`, which is what a failure looked like
// from the outside: a line on stderr that no consumer reads, and a clean bill of health.
//
// ⚠ THE ASSERTIONS READ `summary`, NOT A `verdicts` FIELD. My first probe filtered `h.verdicts` and
// came back empty for BOTH the healthy and the broken graph — there is no such field on the return.
// A test written that way would have passed against the defect and against the fix equally, which
// is the failure mode this whole unit exists to catch. `verdicts` is joined into `summary`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { ensureFresh } from '../../../mcp/stdio/freshness/orchestrator.js';
import { graphHealth } from '../../../mcp/stdio/query/verbs/health.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

let repo;
const dbPath = () => join(repo, '.aify-graph', 'graph.sqlite');

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), 'apg-frag-'));
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'a.js'),
    'export function target() { return 1; }\nexport function caller() { return target(); }\n');
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '-A'); git('commit', '-qm', 'base');
  await ensureFresh({ repoRoot: repo });
});

afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

const summary = async () => String((await graphHealth({ repoRoot: repo })).summary);

describe('the fragment-external count can say that it failed', () => {
  it('POSITIVE CONTROL: a readable graph with no fragments says nothing at all', async () => {
    // ⛔ Without this the NOT MEASURED wording could be unconditional, and a warning printed on
    // every health call is one nobody reads. This is also the control for the two cases below:
    // it proves silence is still reachable, so silence there means something.
    const out = await summary();
    expect(out, 'the summary must be produced at all').toMatch(/nodes=\d+/);
    expectAbsentWithLiveMatcher(
      /stale-externals/,
      {
        forbidden: 'stale-externals: NOT MEASURED — the External-label scan could not read this graph',
        allowed: 'nodes=9 edges=6',
      },
      out,
      'a clean graph was given a stale-externals verdict',
    );
  });

  it('POSITIVE CONTROL: a fragment-labelled External IS counted and reported', async () => {
    // ⛔ THE ALLOW PATH, PROVEN REACHABLE. A denial whose closed state is permanent is off, not
    // fail-closed — and the same applies here in reverse: if the measured branch could no longer
    // report a count, the NOT MEASURED test below would pass against a scanner that never works.
    const db = openDb(dbPath());
    try {
      db.run("INSERT INTO nodes (id, type, label, file_path) VALUES ('x1', 'External', 'entries()]', '')");
    } finally { db.close(); }
    const out = await summary();
    expect(out, 'a fragment label must be counted and named').toMatch(/stale-externals: 1 External nodes/);
  });

  it('⛔ a read that FAILS says NOT MEASURED, and does not wear the clean answer', async () => {
    // Renaming the column makes exactly this scan fail — `SELECT label FROM nodes` throws "no such
    // column: label" — while `count(*) FROM nodes`, the census and the language query all still
    // work, so health returns and the rest of the summary is intact. A surgical failure of the one
    // read under test, rather than a broken database that proves nothing about this branch.
    const db = openDb(dbPath());
    try { db.exec('ALTER TABLE nodes RENAME COLUMN label TO label_x'); } finally { db.close(); }

    const out = await summary();
    expect(out, 'the failure must reach the summary').toMatch(/stale-externals: NOT MEASURED/);
    expect(out, 'and name what failed, so the reader can act on it').toMatch(/no such column: label/);
    expect(out, 'and say plainly what it is NOT evidence of')
      .toMatch(/not evidence that there are none/);

    // ⛔ UNKNOWN UNDER ITS OWN WORDING, never reported as the known case. The count wording asserts
    // a measurement; a failed read must not borrow it.
    expectAbsentWithLiveMatcher(
      /stale-externals: \d+ External nodes/,
      {
        forbidden: 'stale-externals: 0 External nodes carry labels that are not plausible symbol names',
        allowed: 'stale-externals: NOT MEASURED — the External-label scan could not read this graph',
      },
      out,
      'a failed read was reported as a count',
    );
  });
});
