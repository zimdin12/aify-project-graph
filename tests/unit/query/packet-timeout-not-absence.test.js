// ★ A TIMEOUT IS NOT AN ABSENCE.
//
// Root-caused 2026-08-09 from the field test: `graph_packet("SimCoordinator")` on echoes
// returned "ERROR: not found as feature, task, or symbol" — while `graph_consequences` on
// the SAME symbol, overlay and process resolved it to TWO features.
//
// Measured: consequences takes 601ms on a 3958-node repo and 4316ms on a 12126-node one.
// The packet budget is 2000ms. So on any repo large enough to matter the lookup timed out
// and the packet reported the symbol as NOT FOUND — a latency fact rendered as a fact
// about the code, in the flagship orientation verb.
//
// It also explains the count inversion: a UNIQUE match runs the full computation and
// blows the budget, while AMBIGUOUS matches return early and cheap. Not inverted on
// count — inverted on COST. The cleanest input takes the most expensive path.
//
// ★★ CONVERTED FROM SOURCE-GREP 2026-08-11, using the seam the field test named in their
// adjudication: "needs an injectable slow lookup, then assert the TIMED OUT text."
//
// The previous version asserted `featureLookupTimedOut\s*=\s*true` and the ordering of
// two branches by their offsets in packet.js. Both pin an implementation's shape: reorder
// the branches for readability and it goes red having found nothing, while a timeout
// silently rendered as "not found" — the actual defect — sails through.
//
// A mocked lookup that never resolves reaches the real branch in the real verb.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../../../mcp/stdio/storage/db.js';

// The lookup packet.js races against its budget. Hanging forever guarantees the timeout
// branch without depending on machine speed — a sleep just under/over the budget would
// make this flaky on a loaded CI box, which is its own kind of untrustworthy test.
vi.mock('../../../mcp/stdio/query/verbs/consequences.js', () => ({
  graphConsequences: () => new Promise(() => {}),
}));

// ⛔ 24.6s OF THIS FILE WAS PURE WAITING, and it was the single most expensive file in the suite.
// `vitest.config.js` sets APG_LIVE_BUDGET_MS=8000 for the whole run, and this file deliberately hangs
// the lookup FOREVER so that the budget is what fires — three tests x eight seconds.
//
// The hang is the right design and stays: it makes the timeout branch deterministic instead of
// depending on machine speed (see the note above). What the test does not need is for that budget to
// be EIGHT SECONDS. A hang exceeds 250ms just as reliably as it exceeds 8000ms.
//
// Set BEFORE the dynamic import below, because packet-live.js resolves LIVE_BUDGET_MS once at module
// load (`export const LIVE_BUDGET_MS = resolveLiveBudget(process.env.APG_LIVE_BUDGET_MS)`), so an env
// change after import would be INERT — and an inert change here looks exactly like a working one.
process.env.APG_LIVE_BUDGET_MS = '250';

const { graphPacket } = await import('../../../mcp/stdio/query/verbs/packet.js');

let repoRoot;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'apg-timeout-'));
  await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', repoRoot, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repoRoot, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 0, edges: 0,
    schemaVersion: 4, extractorVersion: '0.1.0', status: 'ok',
    dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));

  // ONE definition — a unique match, which is the expensive path that actually times out.
  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
     VALUES ('sc', 'Class', 'SimCoordinator', 'src/sim.cpp', 10, 40, 'cpp', 1, '{}')`,
  );
  db.close();
});

afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* windows lock */ } }
});

const asText = (o) => (typeof o === 'string' ? o : JSON.stringify(o));

describe('a feature lookup that times out is not reported as an absence', () => {
  it('★★ NEVER reports "not found" when the lookup merely timed out', async () => {
    // The defect, as a property of the output. This is what the field test received for
    // SimCoordinator: an ERROR claiming the symbol did not exist, for a symbol that did.
    const text = asText(await graphPacket({ repoRoot, target: 'SimCoordinator' }));

    expect(text, 'harness sanity: the mocked hang must reach the timeout branch').toMatch(/TIMED OUT/);
    expect(text, 'a latency fact must never render as a fact about the code')
      .not.toMatch(/not found as feature, task, or symbol/);
  }, 20_000);

  it('★ says explicitly that nothing here means the symbol is absent', async () => {
    const text = asText(await graphPacket({ repoRoot, target: 'SimCoordinator' }));

    expect(text).toMatch(/this is NOT "symbol not found"/);
    expect(text).toMatch(/NOTHING here says the symbol is absent or unmapped/);
  }, 20_000);

  it('★ names the unbudgeted verb that will actually answer', async () => {
    // Telling a reader the lookup timed out without naming the call that has no budget
    // leaves them with a dead end — the same failure as the ambiguous path before it
    // named its disambiguating step.
    const text = asText(await graphPacket({ repoRoot, target: 'SimCoordinator' }));

    expect(text).toMatch(/graph_consequences\(target=/);
  }, 20_000);
});
