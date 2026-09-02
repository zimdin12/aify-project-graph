// ⛔ WHEN THE RESULTS TRUST BANNER CANNOT BE BUILT, THE AGENT MUST BE TOLD.
//
// Preregistered: docs/evidence/m2-construct-coverage/PREREGISTRATION-results-banner-fails-open.md
//
// Sibling of contract-failure-is-disclosed.test.js, which covers the ABSENCE path. This covers the
// RESULTS path: 7 of 8 `buildTrustLine` call sites swallow into a comment-only catch, and that banner
// is what carries the FLOOR statement — that a returned caller set is heuristic, not exhaustive.
// Losing it silently lets a partial list read as complete.
//
// ⚠ WEAKER THAN THE ABSENCE CASE, said plainly: the agent holds positive evidence either way. This is
// about a caller set reading as COMPLETE, not about a bare absence licensing a deletion.
//
// ⚠ CEILING: behaviour under an INDUCED fault on one fixture. It does not estimate how often
// buildTrustLine throws in production, and does not show an agent would act differently.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
// A symbol that HAS callers, so the results path runs rather than the absence path.
const CALLED = 'src::shapes::helper';

let threw = 0;

vi.mock('../../../mcp/stdio/query/lsp-evidence.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    buildTrustLine: async () => { threw += 1; throw new Error('induced: results banner failed'); },
  };
});

let repo;
let healthyText = '';

beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), 'apg-banner-fail-'));
  cpSync(join(ROOT, 'tests/fixtures/identity-hostile'), repo, { recursive: true });
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '-A'); git('commit', '-qm', 'init');
  const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');
  await ensureFresh({ repoRoot: repo });

  // The un-faulted banner, obtained with the REAL builder, so "no TRUST" under fault can be told
  // apart from "this fixture never had one".
  const real = await vi.importActual('../../../mcp/stdio/query/lsp-evidence.js');
  const { openExistingDb } = await import('../../../mcp/stdio/storage/db.js');
  const db = openExistingDb(join(repo, '.aify-graph', 'graph.sqlite'));
  try {
    healthyText = String(await real.buildTrustLine({ edges: [], db, repoRoot: repo }));
  } finally { db.close?.(); }
}, 180_000);

afterAll(() => { if (repo) rmSync(repo, { recursive: true, force: true }); });

async function resultsUnderFault(module, fn, args) {
  threw = 0;
  const mod = await import(`../../../mcp/stdio/query/verbs/${module}`);
  const text = String(await mod[fn]({ repoRoot: repo, ...args }));
  return { text, threw };
}

describe('a result whose trust banner failed to build', () => {
  it('POSITIVE CONTROL: the real banner carries a trust statement at all', () => {
    // If the un-faulted banner said nothing about trust, its absence under fault would mean nothing.
    expect(healthyText.length, 'the real builder produced nothing — the comparison is vacuous')
      .toBeGreaterThan(0);
    expect(healthyText).toMatch(/TRUST/i);
  });

  it('POSITIVE CONTROL: the induced fault fires AND the query returned edges', async () => {
    // Two ways this probe could be vacuous: the mock not applying, or the query hitting the absence
    // path instead of the results path. Both are excluded here, in the same pass.
    const { text, threw: n } = await resultsUnderFault('callers.js', 'graphCallers', { symbol: CALLED });
    expect(n, 'the banner builder was never called — the fault did not fire').toBeGreaterThan(0);
    // ⚠ A LIVE matcher, not a bare not.toMatch. The repo ratchets those down because a negative
    // assertion whose matcher never fires is indistinguishable from a passing one — and my first
    // version of this line was exactly that bare form, caught by the ratchet.
    expectAbsentWithLiveMatcher(
      /^NO CALLERS/m,
      { forbidden: 'NO CALLERS for "x". Try graph_whereis', allowed: 'EDGE a→b CALLS src/x.cpp:1' },
      text,
      'the query took the ABSENCE path, so it says nothing about the results banner',
    );
  }, 90_000);

  // The verbs whose results path this fixture can actually DRIVE. Each runs the real code under the
  // fault rather than reading source text — the suite-composition ratchet refused a source-scan
  // version of this check, with evidence: such tests "cannot fail when the behaviour breaks, and CAN
  // fail when a line is reflowed", which happened three times on 2026-08-11, each on a fix.
  const DRIVEN = [
    { verb: 'graph_callers', module: 'callers.js', fn: 'graphCallers', args: { symbol: CALLED } },
    { verb: 'graph_callees', module: 'callees.js', fn: 'graphCallees', args: { symbol: 'use_helper' } },
    { verb: 'graph_impact', module: 'impact.js', fn: 'graphImpact', args: { symbol: CALLED } },
    { verb: 'graph_neighbors', module: 'neighbors.js', fn: 'graphNeighbors', args: { symbol: CALLED } },
  ];

  // ⚠ NOT COVERED BEHAVIOURALLY, and named rather than quietly omitted: change_plan, preflight and
  // explain_diff also disclose now, but this fixture cannot drive their results paths. Their fix is
  // verified only by reading. That is a real gap, and stating it is better than a source-text gate
  // that would go green without exercising anything.
  const NOT_DRIVEN = ['graph_change_plan', 'graph_preflight', 'graph_explain_diff'];

  for (const d of DRIVEN) {
    it(`★★★ ${d.verb} TELLS the agent the banner is unavailable`, async () => {
      const { text } = await resultsUnderFault(d.module, d.fn, d.args);
      // Results still returned: a banner bug must not take the verb down.
      expect(text, `${d.verb} stopped answering — the fix must not block the verb`).toMatch(/EDGE/);
      expect(text, 'a set with no floor caveat reads as COMPLETE').toMatch(/TRUST: UNAVAILABLE/);
    }, 90_000);
  }

  it('the sites this fixture cannot drive are NAMED, not silently dropped', () => {
    expect(NOT_DRIVEN).toEqual(['graph_change_plan', 'graph_preflight', 'graph_explain_diff']);
  });
});
