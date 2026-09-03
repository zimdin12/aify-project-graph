// ⛔ THE CLAUSE MUST REACH THE AGENT, NOT MERELY COMPOSE.
//
// `absence-names-uncommitted-sources.test.js` proves `uncommittedSourceClause` builds the right
// string, and `every-absence-names-its-scope.test.js` proves every emitter says SOMETHING about
// scope. Neither one puts a real untracked file on disk and asks a verb about a symbol inside it —
// so a change that stopped wiring the clause into the absence path would leave both of them green
// while an agent got a bare `NO MATCH` for code it had just written.
//
// That gap has a name in this repo's history: wired is not consumed. This closes it end to end.
//
// ⚠ WHY THIS CASE MATTERS AT ALL. A brand-new untracked file is DELIBERATELY not indexed by an
// incremental run (`shouldDeferUntrackedFreshness`), and the agent asking about it is usually the
// agent that just created it. An undisclosed NO MATCH there is the worst shape of wrong: absence
// asserted about the questioner's own work.
//
// Measured 2026-09-03 across graph_callers/callees/impact plus four controls:
// docs/evidence/m3-freshness/RUN-untracked-disclosure-probe.txt
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

let repo = null;
let graphCallers = null;

beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), 'apg-untracked-named-'));
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'base.js'),
    'export function baseFn() { return 0; }\nexport function callsBase() { return baseFn(); }\n');
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '-A'); git('commit', '-qm', 'base');

  const { graphIndex } = await import('../../../mcp/stdio/query/verbs/index.js');
  ({ graphCallers } = await import('../../../mcp/stdio/query/verbs/callers.js'));
  await graphIndex({ repoRoot: repo, force: false });
}, 180_000);

afterAll(() => { if (repo) { rmSync(repo, { recursive: true, force: true }); repo = null; } });

describe('an absence caused by an untracked file says so, and names the file', () => {
  it('⛔ POSITIVE CONTROL: the graph answers a real question — else every absence below is vacuous', async () => {
    const out = String(await graphCallers({ repoRoot: repo, symbol: 'baseFn' }));
    expect(out, 'the fixture graph must have real edges in it').toMatch(/callsBase/);
  }, 60_000);

  it('⛔ DISCRIMINATOR: a clean tree emits NO uncommitted clause — else the clause is decoration', async () => {
    // Without this, a clause printed unconditionally would satisfy the assertion below while telling
    // the agent nothing. The clause has to be able to stay silent.
    const out = String(await graphCallers({ repoRoot: repo, symbol: 'zzqAbsentSymbol' }));
    expect(out).toMatch(/NO MATCH/);
    // ⛔ NOT a bare not.toMatch. A silent matcher and a clean output look identical in a green run,
    // and this repo has watched a regex corrupted into matching a control byte stay green through
    // two "repairs". The canaries prove /uncommitted/i can fire and that it does not fire on the
    // ordinary miss text, so its silence here is evidence.
    expectAbsentWithLiveMatcher(
      /uncommitted/i,
      {
        forbidden: 'NOT COVERED: src/newthing.js (untracked) — uncommitted, so not indexed.',
        allowed: 'NO MATCH for "zzqAbsentSymbol". Try graph_search(query="zzqAbsentSymbol").',
      },
      out,
      'nothing is uncommitted here, so nothing may be blamed on it',
    );
  }, 60_000);

  it('★★★ a symbol in a NEW untracked file: the absence names that file and a working remedy', async () => {
    const { graphIndex } = await import('../../../mcp/stdio/query/verbs/index.js');
    writeFileSync(join(repo, 'src', 'newthing.js'), 'export function brandNewFn() { return 1; }\n');
    await graphIndex({ repoRoot: repo, force: false });

    const out = String(await graphCallers({ repoRoot: repo, symbol: 'brandNewFn' }));
    expect(out, 'the file is deliberately not indexed, so this must still be a miss').toMatch(/NO MATCH/);
    expect(out, 'the agent must be told WHICH file explains the miss').toMatch(/newthing\.js/);
    expect(out, 'and WHY — an unexplained miss reads as a fact about the repo').toMatch(/uncommitted/i);
  }, 120_000);
});
