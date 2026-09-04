// ⛔ FIFTEEN SECONDS TO LEARN NOTHING.
//
// `code_intel_live.js` waits for navigation readiness with `client.waitForReady(budget)`. In the
// ON-DISK-INDEX state — clangd found an index already built, so no `$/progress` ever fires —
// `indexingState` never becomes `'ready'`, so that call adds a waiter, times out on the FULL budget,
// and returns `navigationFreshness()` — which is `'unknown'`. Measured on a real client:
//
//     waitForReady(1200)        -> "unknown"                                        in 1209 ms
//     waitForIndexReady({1200}) -> { ready: true, reason: 'no_progress_signalled' } in  248 ms
//
// A caller passing `waitForReadyMs: 15000` (the integration test does) pays fifteen seconds for a
// verdict the state machine could have given in a fraction of that.
//
// ⛔⛔ AND THIS TEST PINS THE LATENCY HALF ONLY. Preregistration:
// docs/evidence/m2-contract/PREREGISTERED-routing-waitForReadyMs-through-waitForIndexReady.md
//
// `freshness === 'fresh'` gates SEVEN strong-evidence branches, and the on-disk state returns
// `'unknown'`, so the current behaviour already fails CLOSED — the cost is latency and recall, not
// safety. Mapping `no_progress_signalled` to `'fresh'` would be a CLAIM-STRENGTHENING change resting
// on an inference from the ABSENCE of a signal, and it is deliberately NOT made. The contract test
// below is what stops a later edit smuggling it in.
//
// ⚠ THE GRACE WINDOW IS NOT SHRUNK TO FLATTER THE NUMBER. `settleMs` defaults to 1500 because a
// `$/progress begin` can arrive a beat late; cutting it would return early on a session that was
// about to index and cost the `'fresh'` verdict the long wait legitimately earns. 15000 -> ~1500 is
// the honest win.
//
// ⚠ AND THE REAL CLIENT IS DRIVEN, NOT A STUB. `LspClient`'s constructor spawns nothing, so the
// actual state machine can be put in the state under test. A stub of these two methods would test
// the stub, and what is in question is precisely what the real object does.
import { describe, it, expect } from 'vitest';
import { LspClient } from '../../../mcp/stdio/code-intel/lsp-client.js';
import { awaitFreshness } from '../../../mcp/stdio/query/verbs/code_intel_live.js';

/** A session whose client found an index already on disk: files warmed, no progress ever signalled. */
function onDiskIndexSession() {
  const client = new LspClient({ command: 'noop', cwd: process.cwd(), rootUri: 'file:///x' });
  client.workspaceWarmCount = 1;
  return { client };
}

describe('the readiness wait stops burning its budget to learn nothing', () => {
  it('★★★ an on-disk index resolves in a fraction of the budget', async () => {
    const session = onDiskIndexSession();
    const started = Date.now();
    await awaitFreshness(session, 15000);
    const ms = Date.now() - started;

    // The old path consumed the whole 15000. Generous ceiling so a loaded CI box does not fail this
    // for the wrong reason — the defect was 15000 ms, and anything near it is the defect.
    expect(ms, `readiness took ${ms} ms of a 15000 ms budget`).toBeLessThan(5000);
  }, 30_000);

  it('★★★ and the FRESHNESS VALUE is unchanged — this is a latency fix, not a trust upgrade', async () => {
    // ⛔ THE GATE THAT STOPS THE CLAIM HALF SMUGGLING IN. `waitForIndexReady` reports
    // `{ ready: true, reason: 'no_progress_signalled' }` in this state, and mapping that to
    // `'fresh'` would unlock seven evidence branches on an inference from an absence. The contract
    // sees exactly what it saw before.
    const session = onDiskIndexSession();
    expect(await awaitFreshness(session, 15000),
      'the on-disk state is UNKNOWN, and it stays unknown').toBe('unknown');
  }, 30_000);

  it('★★★ LATENCY CONTROL: a caller passing 0 gains no wait', async () => {
    // Preregistered gate. Measured at 0 ms before the change; it must stay immediate, or the fix
    // has taxed every caller that never asked to wait.
    const session = onDiskIndexSession();
    const started = Date.now();
    const freshness = await awaitFreshness(session, 0);
    const ms = Date.now() - started;
    expect(ms, `a zero budget took ${ms} ms`).toBeLessThan(100);
    expect(freshness).toBe('unknown');
  }, 30_000);

  it('★★★ POSITIVE CONTROL: an already-fresh session still reports fresh', async () => {
    // Without this, a change that returned 'unknown' unconditionally would satisfy the contract test
    // above while destroying every strong-evidence branch — the failure mode that is the whole
    // reason the value is being pinned.
    const session = onDiskIndexSession();
    session.client.indexingState = 'ready';
    expect(await awaitFreshness(session, 15000), 'a genuinely ready server keeps its verdict')
      .toBe('fresh');
  }, 30_000);

  it('★★★ a session with NO readiness API at all degrades to unknown rather than throwing', async () => {
    // The helper already guarded this; pinned because the new path adds a second optional method and
    // an instrument that throws on an ordinary shape reports a false zero for every caller.
    expect(await awaitFreshness({ client: {} }, 15000)).toBe('unknown');
  });
});
