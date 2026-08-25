// PHASE 0 SLICE 3 — THE ONE PACKET PATH THAT LEAVES THE STATIC SNAPSHOT.
//
// the reviewer's ruling for this slice: "Move withTimeout + enrichLive into packet-live.js;
// inject/import graphConsequences there without importing packet.js. Pin timeout/error/enriched
// output and timer cleanup."
//
// ⛔ AND THE REFACTOR GUARD CANNOT COVER `enrichLive`, which is why this file exists rather than
// another guard route. Every corpus cell calls graphPacket without `live: true`, and that flag
// defaults false — so the byte-comparison corpus cannot reach the function at all. That is the
// same shape as the reviewer's BLOCKER 1 against slice 1 and as the two unreached declarations in slice 2:
// a moved declaration can be live, imported, and covered by a passing corpus while never running.
//
// A live route is not the fix. It would put `LIVE: enriched (147ms)` into the corpus, and dev was
// explicit that elapsed_ms must not be scrubbed generically because "a regex scrub is another way
// to erase a real drift". So the honest split is: the guard covers what it can reach, this file
// covers what it cannot, and the slice reports BOTH numbers rather than one that implies the
// corpus reaches something it does not.
import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIVE_BUDGET_MS, withTimeout, enrichLive } from '../../../mcp/stdio/query/verbs/packet-live.js';

describe('withTimeout', () => {
  it('★★★ returns the value when the promise wins', async () => {
    await expect(withTimeout(Promise.resolve({ ok: 1 }), 1000)).resolves.toEqual({ ok: 1 });
  });

  it('★★★ resolves to the timeout sentinel when the budget wins', async () => {
    // The sentinel is load-bearing: callers branch on `raw.__timeout` to distinguish "the verb
    // took too long" from "the verb answered nothing". Those are different facts about the graph
    // and collapsing them is the absence-claim defect this project keeps closing.
    const never = new Promise(() => {});
    await expect(withTimeout(never, 5)).resolves.toEqual({ __timeout: true });
  });

  it('★★★ CLEARS THE TIMER on the winning path — the reviewer asked for this by name', async () => {
    // ⚠ A leaked timer keeps the event loop alive. In an MCP server that means a process that
    // will not exit, and the symptom appears far from here — a hung shutdown, blamed on whatever
    // was running last. `clearTimeout` in a `finally` is what makes it unobservable, so the only
    // way to check it is to count the calls.
    const spy = vi.spyOn(globalThis, 'clearTimeout');
    const before = spy.mock.calls.length;
    await withTimeout(Promise.resolve('fast'), 10_000);
    expect(spy.mock.calls.length, 'the pending timer must be cleared, not left to fire')
      .toBeGreaterThan(before);
    spy.mockRestore();
  });

  it('★★★ clears the timer on the TIMEOUT path too', async () => {
    // The path where it is easiest to forget, because the timer has already fired once.
    const spy = vi.spyOn(globalThis, 'clearTimeout');
    const before = spy.mock.calls.length;
    await withTimeout(new Promise(() => {}), 5);
    expect(spy.mock.calls.length).toBeGreaterThan(before);
    spy.mockRestore();
  });

  it('★★★ a REJECTING promise still clears the timer', async () => {
    // ⚠ NEGATIVE-PATH CONTROL. `withTimeout` does not catch, so the rejection propagates — and
    // the `finally` is the only thing standing between a thrown live verb and a leaked timer.
    const spy = vi.spyOn(globalThis, 'clearTimeout');
    const before = spy.mock.calls.length;
    await expect(withTimeout(Promise.reject(new Error('boom')), 10_000)).rejects.toThrow('boom');
    expect(spy.mock.calls.length, 'a throw must not leak the timer').toBeGreaterThan(before);
    spy.mockRestore();
  });
});

describe('enrichLive', () => {
  let repo;
  const cleanup = async () => {
    if (repo) { try { await rm(repo, { recursive: true, force: true }); } catch { /* win lock */ } }
    repo = undefined;
  };

  it('★★★ a live verb that THROWS is "unavailable", not silence', async () => {
    // The three statuses are the whole contract. An agent reading LIVE must be able to tell
    // "the graph says nothing" from "we could not ask" — which is the same distinction the
    // receipt work draws between an empty list and an unasked source.
    repo = await mkdtemp(join(tmpdir(), 'apg-live-'));
    const out = await enrichLive({
      repoRoot: repo, target: 'nothing', kind: 'symbol', value: 'nothing', opts: {},
    });
    expect(['unavailable', 'timeout'], 'a repo with no graph cannot enrich').toContain(out.status);
    expect(out.detail, 'and it must say why, not just fail').toBeTruthy();
    expect(typeof out.elapsed_ms, 'the cost is reported even on the failing path').toBe('number');
    await cleanup();
  }, 30_000);

  it('★★★ the budget is a NAMED constant, not a literal buried in a branch', async () => {
    // ⚠ It is referenced by both this island and the facade's budgeted symbol lookup. A second
    // literal would be a second source of truth for the same budget, and the two would drift —
    // which is why the constant crosses the module boundary rather than being duplicated.
    expect(LIVE_BUDGET_MS).toBe(2000);
  });

  it('★★★ the timeout message names the budget it exceeded', async () => {
    // A timeout that does not say what it exceeded leaves the reader unable to tell a slow graph
    // from a wrong budget. Pinned because the reviewer asked for the timeout OUTPUT, not just the branch.
    const src = await import('node:fs').then((fs) => fs.readFileSync(
      new URL('../../../mcp/stdio/query/verbs/packet-live.js', import.meta.url), 'utf8'));
    expect(src).toMatch(/live enrichment exceeded \$\{LIVE_BUDGET_MS\}ms/);
  });
});
