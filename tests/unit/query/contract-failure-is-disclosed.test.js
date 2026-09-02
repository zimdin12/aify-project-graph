// ⛔ WHEN THE TRUST CONTRACT CANNOT BE BUILT, THE AGENT MUST BE TOLD.
//
// Preregistered: docs/evidence/m2-construct-coverage/PREREGISTRATION-contract-fails-open.md
//
// Every absence consumer wraps the contract builder in `catch { /* defensive */ }` leaving `line = ''`.
// A throw therefore ships a BARE absence — "NO CALLERS" with no TRUST, no SCOPE, no NOT MODELLED —
// which is the exact unsafe artifact M2 exists to prevent, and is byte-identical to a build without
// the feature.
//
// Not hypothetical: `callers.js:95-97` records this precise catch already hiding a total failure —
// "the scope note threw on every call and its catch returned '', so the feature was inert and the
// output looked exactly as it had before".
//
// ⚠ CEILING: behaviour under an INDUCED fault. It does not estimate how often the builder throws in
// production. A rare fault that silently removes a safety contract is still a defect.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SYM = 'alpha::Widget::render';

let threw = 0;

// The fault: the contract builder throws. Everything else in lsp-evidence keeps its real behaviour,
// so only the path under test changes.
vi.mock('../../../mcp/stdio/query/lsp-evidence.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    buildAbsenceTrustLine: async () => { threw += 1; throw new Error('induced: contract builder failed'); },
  };
});

let repo;

beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), 'apg-contract-fail-'));
  cpSync(join(ROOT, 'tests/fixtures/identity-hostile'), repo, { recursive: true });
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '-A'); git('commit', '-qm', 'init');
  const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');
  await ensureFresh({ repoRoot: repo });
}, 180_000);

afterAll(() => { if (repo) rmSync(repo, { recursive: true, force: true }); });

// ⛔ ALL FIVE CONSUMERS, not the one I happened to reach for. Fixing one verb and assuming the rest
// followed is the mistake this project has already made once with this exact contract: "one consumer
// works" was read as "the contract is delivered".
const CONSUMERS = [
  { verb: 'graph_callers', module: 'callers.js', fn: 'graphCallers', claim: 'NO CALLERS', args: { symbol: SYM } },
  { verb: 'graph_callees', module: 'callees.js', fn: 'graphCallees', claim: 'NO CALLEES', args: { symbol: SYM } },
  { verb: 'graph_impact', module: 'impact.js', fn: 'graphImpact', claim: 'NO IMPACT', args: { symbol: SYM } },
  { verb: 'graph_neighbors', module: 'neighbors.js', fn: 'graphNeighbors', claim: 'NO NEIGHBORS', args: { symbol: SYM, edge_types: ['CALLS'] } },
  { verb: 'graph_trace', module: 'trace.js', fn: 'graphTrace', claim: 'NO STATIC PATH', args: { from: SYM, to: 'beta::Widget::render' } },
];

async function underFault({ module, fn, args }) {
  threw = 0;
  const mod = await import(`../../../mcp/stdio/query/verbs/${module}`);
  const text = String(await mod[fn]({ repoRoot: repo, ...args }));
  return { text, threw };
}

describe('an absence whose trust contract failed to build', () => {
  it('POSITIVE CONTROL: the induced fault actually fires', async () => {
    // A mock that silently failed to apply would produce the HEALTHY output, and I would read that
    // as "fails closed" — the wrong answer, arrived at confidently.
    const { threw: n } = await underFault(CONSUMERS[0]);
    expect(n, 'the builder was never called — the fault did not fire, so nothing below means anything')
      .toBeGreaterThan(0);
  }, 60_000);

  for (const consumer of CONSUMERS) {
    it(`★★★ ${consumer.verb} TELLS the agent the contract is unavailable`, async () => {
      const { text } = await underFault(consumer);
      // The answer is still returned: a trust-line bug must not take the verb down.
      expect(text, `${consumer.verb} stopped answering — the fix must not block the verb`)
        .toContain(consumer.claim);
      // And it must not read as an unqualified absence.
      expect(text, 'a bare absence with no trust statement is the unsafe artifact M2 exists to prevent')
        .toMatch(/TRUST: UNAVAILABLE/);
    }, 90_000);
  }
});
