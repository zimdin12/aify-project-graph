// ⛔ "NO CALLERS" IS A DELETION LICENCE, AND IT WAS ISSUED OVER THE AGENT'S OWN UNCOMMITTED WORK.
//
// An agent asks "who calls X" precisely when deciding whether X is safe to delete. If the only
// caller lives in a file it has written and not committed, the graph answered "NO CALLERS", the
// agent deleted X, and it broke its own in-flight work — a failure grep would not have produced.
//
// ⚠ MEASURED THROUGH THE VERB BEFORE BUILDING, both populations, predictions registered first:
//   A. caller in an UNTRACKED file       -> nothing disclosed  (predicted, held)
//   B. caller in a MODIFIED TRACKED file -> the dirty-tree warning appeared, but it never says a
//                                           CALLER could be in it  (predicted, held)
// POSITIVE CONTROL in the same pass: a COMMITTED caller IS reported, so those zeros were measured
// absences and not a broken query.
//
// ⚠ THE GENERIC TRUST LINE DOES NOT COVER THIS. It already says the absence "is NOT exhaustive",
// and by this repo's own standard that is not enough: "a generic 'results may be incomplete' costs
// the reader as much as a false claim — they go and check either way." Naming the file is what
// makes the doubt resolvable.
import { describe, it, expect, afterEach } from 'vitest';
import { readdirSync, readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const VERBS_DIR = join(ROOT, 'mcp/stdio/query/verbs');

// ⛔ THE POPULATION IS DERIVED, NOT LISTED. Every previous absence fix in this repo was applied
// verb by verb and missed one: graph_consequences and graph_trace hand-rolled their own NO MATCH
// and never got the fix that callers/callees/impact received. A hand-maintained list here would
// reproduce that exactly — a new verb calling the shared builder would silently emit no disclosure
// and no test would notice.
//
// So the list of verbs that USE the builder is read from source, and the drive-list below must
// cover it. Adding a verb that calls buildAbsenceTrustLine without adding it here FAILS, rather
// than quietly losing the disclosure.
function verbsUsingAbsenceBuilder() {
  return readdirSync(VERBS_DIR)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => /buildAbsenceTrustLine\s*\(\s*\{/.test(readFileSync(join(VERBS_DIR, f), 'utf8')))
    .sort();
}

// Each entry drives the verb into its EMPTY-SET branch on the fixture below.
const DRIVEN = [
  { module: 'callers.js', fn: 'graphCallers', args: { symbol: 'targetFn' } },
  { module: 'callees.js', fn: 'graphCallees', args: { symbol: 'targetFn' } },
  { module: 'impact.js', fn: 'graphImpact', args: { symbol: 'targetFn' } },
  // ⚠ edge_types NARROWED ON PURPOSE. With its default relations graph_neighbors finds the
  // containment edges every symbol has (its file declares it), returns EDGE rows, and never reaches
  // its absence branch — the first version of this test asserted a disclosure against a populated
  // answer and failed for that reason, not because the product was wrong. targetFn has no CALLS
  // edge in either direction, so this reaches the branch under test honestly.
  { module: 'neighbors.js', fn: 'graphNeighbors', args: { symbol: 'targetFn', edge_types: ['CALLS'] } },
  { module: 'trace.js', fn: 'graphTrace', args: { from: 'targetFn', to: 'unrelatedFn' } },
];

let repo = null;
afterEach(() => { if (repo) { rmSync(repo, { recursive: true, force: true }); repo = null; } });

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'apg-emptyset-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  // targetFn is committed, calls nothing and is called by nothing — every verb below lands on its
  // empty-set branch rather than its NO MATCH branch, which is a different code path with its own
  // disclosure (staleNotFoundCaveat) and its own tests.
  writeFileSync(join(dir, 'src', 'target.js'), 'export function targetFn(){ return 41; }\n');
  writeFileSync(join(dir, 'src', 'other.js'), 'export function unrelatedFn(){ return 1; }\n');
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '-A'); git('commit', '-qm', 'base');
  return dir;
}

describe('an empty-set absence names uncommitted files that could hold what it did not find', () => {
  it('⛔ every verb using the shared builder is actually driven here', () => {
    // The cross-check that makes this file a census instead of a sample.
    const used = verbsUsingAbsenceBuilder();
    const driven = DRIVEN.map((d) => d.module).sort();
    expect(used, 'a verb calls buildAbsenceTrustLine but no test below drives it').toEqual(driven);
    // POSITIVE CONTROL on the scanner itself: a zero here would make the assertion above vacuous,
    // and an empty === empty comparison passes silently.
    expect(used.length, 'the source scan found NO verbs — it is broken, not the code').toBeGreaterThan(0);
  });

  for (const { module, fn, args } of DRIVEN) {
    it(`★★★ ${fn} discloses an UNTRACKED file on its empty-set answer`, async () => {
      const { graphIndex } = await import('../../../mcp/stdio/query/verbs/index.js');
      const mod = await import(`../../../mcp/stdio/query/verbs/${module}`);
      repo = makeRepo();
      await graphIndex({ repoRoot: repo, force: true });

      // ⛔ CONTROL FIRST: on the CLEAN tree the answer must be silent, or the assertion after it
      // proves only that this clause is unconditional prose.
      const clean = String(await mod[fn]({ repoRoot: repo, ...args }));

      // ⛔ THE BRANCH-REACHED PRECONDITION, AND IT IS NOT CEREMONY. graph_neighbors with its default
      // edge_types returns the containment edges every symbol has, so it never reached its absence
      // branch at all — the first run of this file asserted a disclosure against a populated EDGE
      // list and failed for the wrong reason. A test that cannot show it reached the branch under
      // test proves nothing about that branch, whichever way it goes.
      //
      // No /i flag: an earlier census in this repo used one and matched "no functionality" and
      // "no compile" as absence markers.
      expect(clean, `${fn} did not reach its empty-set branch on this fixture — nothing below is about absence`)
        .toMatch(/\bNO [A-Z]{2,}/);

      // ⛔ A LIVE MATCHER, NOT A BARE not.toMatch — and the repo's ratchet caught me writing the
      // bare form here, in the same session I used the helper correctly one file over. This is the
      // control that makes every assertion below it mean something, so a matcher that silently
      // could not fire would hollow out the whole test rather than one line of it.
      expectAbsentWithLiveMatcher(
        /uncommitted source file/i,
        {
          forbidden: 'NOTE: 1 uncommitted source file(s) are NOT covered by this answer',
          allowed: `NO CALLERS for "targetFn". TRUST: absence is from the heuristic graph`,
        },
        clean,
        'a clean tree has nothing uncommitted to disclose',
      );

      // Now the agent writes a caller and does not commit it.
      writeFileSync(join(repo, 'src', 'newcaller.js'),
        "import { targetFn } from './target.js';\nexport function brandNewCaller(){ return targetFn(); }\n");
      const dirty = String(await mod[fn]({ repoRoot: repo, ...args }));

      expect(dirty, 'the uncommitted file must be named').toMatch(/src\/newcaller\.js/);
      expect(dirty).toMatch(/uncommitted source file/i);
    }, 120_000);
  }

  it('the disclosure appears at most ONCE, not on both the caveat and the trust line', async () => {
    // staleNotFoundCaveat (NO MATCH) and buildAbsenceTrustLine (empty set) both carry this clause
    // now. They are disjoint branches today — a resolved symbol with no edges never reaches the
    // NO MATCH path — but "today" is not a guarantee, and a doubled caveat is the warning wall this
    // project already had to tear out once.
    const { graphIndex } = await import('../../../mcp/stdio/query/verbs/index.js');
    const { graphCallers } = await import('../../../mcp/stdio/query/verbs/callers.js');
    repo = makeRepo();
    await graphIndex({ repoRoot: repo, force: true });
    writeFileSync(join(repo, 'src', 'newcaller.js'),
      "import { targetFn } from './target.js';\nexport function brandNewCaller(){ return targetFn(); }\n");

    for (const symbol of ['targetFn', 'noSuchSymbolAtAllZzz']) {
      const answer = String(await graphCallers({ repoRoot: repo, symbol }));
      const hits = (answer.match(/uncommitted source file/gi) ?? []).length;
      expect(hits, `"${symbol}" emitted the uncommitted clause ${hits} times`).toBeLessThanOrEqual(1);
    }
  }, 120_000);
});
